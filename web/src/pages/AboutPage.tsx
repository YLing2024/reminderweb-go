import { useNavigate } from 'react-router-dom';
import { ArrowBackIcon } from '../components/icons';
import { IconButton } from '../components/ui';
import styles from './AboutPage.module.css';

/** 应用版本，与 package.json 保持一致。 */
const APP_VERSION = '0.1.0';

/** 源码仓库（公开地址，非私有域名）。 */
const REPO_URL = 'https://github.com/YLing2024/ReminderWeb';

interface LicenseEntry {
  name: string;
  license: string;
  note?: string;
}

const RUNTIME_LICENSES: LicenseEntry[] = [
  { name: 'React / React DOM', license: 'MIT' },
  { name: 'React Router', license: 'MIT' },
  { name: 'Zustand', license: 'MIT' },
  { name: 'lunar-javascript', license: 'MIT', note: '农历换算，与上游 tyme4kt 同源生态' },
  { name: '@material/material-color-utilities', license: 'Apache-2.0' },
  { name: 'fflate', license: 'MIT' },
  { name: 'idb-keyval', license: 'MIT' },
];

const DEV_LICENSES: LicenseEntry[] = [
  { name: 'Vite', license: 'MIT' },
  { name: 'Vitest', license: 'MIT' },
  { name: 'TypeScript', license: 'Apache-2.0' },
  { name: 'ESLint', license: 'MIT' },
];

export default function AboutPage() {
  const navigate = useNavigate();
  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <IconButton label="返回" onClick={() => navigate(-1)}>
          <ArrowBackIcon />
        </IconButton>
        <h1 className={styles.title}>关于</h1>
      </header>

      <div className={styles.content}>
        <section className={styles.card}>
          <p className={styles.appName}>ReminderWeb</p>
          <p className={styles.appVersion}>版本 {APP_VERSION}</p>
          <p className={styles.appLicense}>本应用以 GPL-3.0 许可发布，上游 Reminder 亦为 GPL-3.0。</p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>字体</h2>
          <ul className={styles.list}>
            <li className={styles.item}>
              <span className={styles.name}>Dancing Script</span>
              <span className={styles.license}>SIL OFL 1.1</span>
              <span className={styles.note}>
                作者 The Dancing Script Project Authors；来源 Google Fonts；仓库内自托管 woff2 子集（仅
                Reminder 所需字形），本地加载、不走 CDN。字体缺失时回退衬线斜体。
              </span>
            </li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>运行依赖</h2>
          <ul className={styles.list}>
            {RUNTIME_LICENSES.map((entry) => (
              <li key={entry.name} className={styles.item}>
                <span className={styles.name}>{entry.name}</span>
                <span className={styles.license}>{entry.license}</span>
                {entry.note !== undefined && <span className={styles.note}>{entry.note}</span>}
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>构建工具</h2>
          <ul className={styles.list}>
            {DEV_LICENSES.map((entry) => (
              <li key={entry.name} className={styles.item}>
                <span className={styles.name}>{entry.name}</span>
                <span className={styles.license}>{entry.license}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>仓库</h2>
          <a className={styles.link} href={REPO_URL} target="_blank" rel="noreferrer">
            源码与问题反馈
          </a>
        </section>
      </div>
    </div>
  );
}
