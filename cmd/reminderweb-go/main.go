// Command reminderweb-go 是纪念日提醒的 Web 端 + 同步后端（Go 重写版）。
//
// 启动流程：读环境变量 → 建库 → 建同步引擎 → 起 HTTP → 优雅退出。
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	reminderweb "reminderweb-go"
	"reminderweb-go/internal/auth"
	"reminderweb-go/internal/config"
	"reminderweb-go/internal/httpapi"
	"reminderweb-go/internal/store"
	"reminderweb-go/internal/sync"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "启动失败：%v\n", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		return err
	}
	logger := newLogger(cfg.LogLevel)

	if cfg.StaticOnly {
		return serveStaticOnly(cfg, logger)
	}

	db, err := store.Open(store.Params{
		Host:     cfg.DBHost,
		Port:     cfg.DBPort,
		Name:     cfg.DBName,
		User:     cfg.DBUser,
		Password: cfg.DBPassword,
		DSN:      cfg.DBDSN,
	})
	if err != nil {
		return err
	}
	defer func() { _ = db.Close() }()

	if cfg.AuthMode == config.AuthBuiltin {
		result, err := auth.EnsureInitialUser(db, cfg.AuthUser, cfg.AuthPassword, time.Now().UnixMilli())
		if err != nil {
			return err
		}
		if result.Created && result.GeneratedPassword != "" {
			printGeneratedPassword(cfg.AuthUser, result.GeneratedPassword)
		}
		if config.IsWeakAuthPassword(cfg) {
			printWeakPasswordWarning(cfg.AuthUser)
		}
	} else if cfg.AuthMode == config.AuthNone {
		logger.Warn("AUTH_MODE=none 关闭了认证，仅可用于本机开发，切勿部署到公网。")
	}

	limiter := auth.NewRateLimiter(cfg.LoginRateLimit, auth.LoginWindowMS, nil)
	// 始终创建引擎：WebDAV 连接与开关都可在页面修改（存库）；初始值来自环境变量（首次默认）。
	engine := sync.New(cfg, db, logger, sync.Deps{})
	handler := httpapi.New(httpapi.Options{
		Config:      cfg,
		DB:          db,
		RateLimiter: limiter,
		Sync:        engine,
		Logger:      logger,
		StaticFS:    reminderweb.DistFS(),
	})
	engine.Start()

	server := &http.Server{
		Addr:              net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port)),
		Handler:           handler.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	listener, err := net.Listen("tcp", server.Addr)
	if err != nil {
		return err
	}
	logger.Info("ReminderWeb 服务已启动 | " + cfg.Describe())

	go func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("服务器错误：" + err.Error())
			os.Exit(1)
		}
	}()

	return waitForShutdown(server, engine, db, logger)
}

func serveStaticOnly(cfg *config.Config, logger *slog.Logger) error {
	handler := httpapi.New(httpapi.Options{
		Config:   cfg,
		StaticFS: reminderweb.DistFS(),
	})
	server := &http.Server{
		Addr:              net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port)),
		Handler:           handler.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	listener, err := net.Listen("tcp", server.Addr)
	if err != nil {
		return err
	}
	logger.Info("ReminderWeb 纯静态模式已启动（只托管前端产物）| " + cfg.Describe())
	go func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("服务器错误：" + err.Error())
		}
	}()
	return waitForShutdown(server, nil, nil, logger)
}

func waitForShutdown(server *http.Server, engine *sync.Engine, db *store.DB, logger *slog.Logger) error {
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	sig := <-signals
	logger.Info("收到 " + signalName(sig) + "，正在关闭…")
	if engine != nil {
		engine.Stop()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		logger.Error("关闭服务器超时：" + err.Error())
	}
	if db != nil {
		_ = db.Close()
	}
	logger.Info("已停止。")
	return nil
}

func signalName(sig os.Signal) string {
	switch sig {
	case syscall.SIGINT:
		return "SIGINT"
	case syscall.SIGTERM:
		return "SIGTERM"
	}
	return "信号"
}

func newLogger(level config.LogLevel) *slog.Logger {
	var slogLevel slog.Level
	switch level {
	case "debug":
		slogLevel = slog.LevelDebug
	case "warn":
		slogLevel = slog.LevelWarn
	case "error":
		slogLevel = slog.LevelError
	default:
		slogLevel = slog.LevelInfo
	}
	return slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slogLevel}))
}

func printGeneratedPassword(username, password string) {
	line := strings.Repeat("=", 64)
	fmt.Println(line)
	fmt.Printf("已生成一次性初始口令（用户 %s），请立即记录并登录后尽快修改：\n", username)
	fmt.Printf("    %s\n", password)
	fmt.Println("该口令只显示这一次，之后不会再次打印。")
	fmt.Println(line)
}

func printWeakPasswordWarning(username string) {
	line := strings.Repeat("=", 64)
	fmt.Println(line)
	fmt.Println("警告：当前使用的是默认口令或过短口令（长度 < 8），存在被登录的风险。")
	fmt.Printf("请尽快修改环境变量 AUTH_PASSWORD（用户 %s），或在登录后于设置页修改口令。\n", username)
	fmt.Println(line)
}
