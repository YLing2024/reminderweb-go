declare module 'lunar-javascript' {
  export interface Solar {
    getYear(): number;
    getMonth(): number;
    getDay(): number;
    getWeek(): number;
    getWeekInChinese(): string;
    getLunar(): Lunar;
    toYmd(): string;
  }

  export interface Lunar {
    getYear(): number;
    getMonth(): number;
    getDay(): number;
    getYearInGanZhi(): string;
    getYearInChinese(): string;
    getYearShengXiao(): string;
    getMonthInChinese(): string;
    getDayInChinese(): string;
    getSolar(): Solar;
  }

  export interface LunarMonth {
    getYear(): number;
    getMonth(): number;
    getDayCount(): number;
    isLeap(): boolean;
    next(amount: number): LunarMonth;
  }

  export interface LunarYear {
    getYear(): number;
    getGanZhi(): string;
    getMonthsInYear(): LunarMonth[];
  }

  export const Solar: {
    fromYmd(year: number, month: number, day: number): Solar;
    fromDate(date: Date): Solar;
  };

  export const Lunar: {
    fromYmd(year: number, month: number, day: number): Lunar;
  };

  export const LunarMonth: {
    fromYm(year: number, month: number): LunarMonth;
  };

  export const LunarYear: {
    fromYear(year: number): LunarYear;
  };
}
