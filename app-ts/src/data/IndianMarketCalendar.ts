/**
 * Indian Market Calendar
 * 
 * Trading hours, holidays, and session detection for NSE and MCX
 */

/**
 * Market session type
 */
export type MarketSession = 'PRE_OPEN' | 'TRADING' | 'POST_CLOSE' | 'CLOSED';

/**
 * Exchange type
 */
export type Exchange = 'NSE' | 'BSE' | 'MCX';

/**
 * Trading hours configuration
 */
interface TradingHours {
  preOpen?: { start: string; end: string };
  trading: { start: string; end: string };
  postClose?: { start: string; end: string };
}

/**
 * NSE/BSE trading hours (IST)
 */
const NSE_HOURS: TradingHours = {
  preOpen: { start: '09:00', end: '09:15' },
  trading: { start: '09:15', end: '15:30' },
  postClose: { start: '15:40', end: '16:00' },
};

/**
 * MCX trading hours (IST) - Regular session
 */
const MCX_HOURS: TradingHours = {
  trading: { start: '09:00', end: '23:30' },
};

/**
 * NSE holidays for 2024-2025
 * Update this list annually
 */
const NSE_HOLIDAYS_2024: string[] = [
  '2024-01-26', // Republic Day
  '2024-03-08', // Maha Shivaratri
  '2024-03-25', // Holi
  '2024-03-29', // Good Friday
  '2024-04-11', // Id-Ul-Fitr
  '2024-04-14', // Dr. Ambedkar Jayanti
  '2024-04-17', // Ram Navami
  '2024-04-21', // Mahavir Jayanti
  '2024-05-01', // Maharashtra Day
  '2024-05-23', // Buddha Purnima
  '2024-06-17', // Bakri Id
  '2024-07-17', // Muharram
  '2024-08-15', // Independence Day
  '2024-10-02', // Gandhi Jayanti
  '2024-10-12', // Dussehra (Vijaya Dashami)
  '2024-11-01', // Diwali Laxmi Pujan
  '2024-11-15', // Guru Nanak Jayanti
  '2024-12-25', // Christmas
];

const NSE_HOLIDAYS_2025: string[] = [
  '2025-01-26', // Republic Day
  '2025-02-26', // Maha Shivaratri
  '2025-03-14', // Holi
  '2025-03-31', // Id-Ul-Fitr
  '2025-04-10', // Mahavir Jayanti
  '2025-04-14', // Dr. Ambedkar Jayanti
  '2025-04-18', // Good Friday
  '2025-05-01', // Maharashtra Day
  '2025-05-12', // Buddha Purnima
  '2025-06-07', // Bakri Id
  '2025-08-15', // Independence Day
  '2025-08-16', // Parsi New Year
  '2025-08-27', // Janmashtami
  '2025-10-02', // Gandhi Jayanti / Dussehra
  '2025-10-21', // Diwali Laxmi Pujan
  '2025-10-22', // Diwali Balipratipada
  '2025-11-05', // Guru Nanak Jayanti
  '2025-12-25', // Christmas
];

const NSE_HOLIDAYS = [...NSE_HOLIDAYS_2024, ...NSE_HOLIDAYS_2025];

/**
 * Indian Market Calendar class
 */
export class IndianMarketCalendar {
  private exchange: Exchange;
  private timezone: string = 'Asia/Kolkata';
  
  constructor(exchange: Exchange = 'NSE') {
    this.exchange = exchange;
  }
  
  /**
   * Check if market is open right now
   */
  isMarketOpen(): boolean {
    const now = this.getISTTime();
    return this.getCurrentSession() === 'TRADING';
  }
  
  /**
   * Get current market session
   */
  getCurrentSession(): MarketSession {
    const now = this.getISTTime();
    const currentTime = this.formatTime(now);
    const dayOfWeek = now.getDay();
    
    // Check weekends
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return 'CLOSED';
    }
    
    // Check holidays
    if (this.isHoliday(now)) {
      return 'CLOSED';
    }
    
    const hours = this.exchange === 'MCX' ? MCX_HOURS : NSE_HOURS;
    
    // Check pre-open
    if (hours.preOpen && this.isTimeInRange(currentTime, hours.preOpen.start, hours.preOpen.end)) {
      return 'PRE_OPEN';
    }
    
    // Check trading
    if (this.isTimeInRange(currentTime, hours.trading.start, hours.trading.end)) {
      return 'TRADING';
    }
    
    // Check post-close
    if (hours.postClose && this.isTimeInRange(currentTime, hours.postClose.start, hours.postClose.end)) {
      return 'POST_CLOSE';
    }
    
    return 'CLOSED';
  }
  
  /**
   * Check if a date is a holiday
   */
  isHoliday(date: Date = new Date()): boolean {
    const dateStr = this.formatDate(date);
    return NSE_HOLIDAYS.includes(dateStr);
  }
  
  /**
   * Check if a date is a trading day
   */
  isTradingDay(date: Date = new Date()): boolean {
    const dayOfWeek = date.getDay();
    
    // Weekend check
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return false;
    }
    
    // Holiday check
    if (this.isHoliday(date)) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Get next trading day
   */
  getNextTradingDay(from: Date = new Date()): Date {
    const next = new Date(from);
    next.setDate(next.getDate() + 1);
    
    while (!this.isTradingDay(next)) {
      next.setDate(next.getDate() + 1);
    }
    
    return next;
  }
  
  /**
   * Get previous trading day
   */
  getPreviousTradingDay(from: Date = new Date()): Date {
    const prev = new Date(from);
    prev.setDate(prev.getDate() - 1);
    
    while (!this.isTradingDay(prev)) {
      prev.setDate(prev.getDate() - 1);
    }
    
    return prev;
  }
  
  /**
   * Get time until market opens
   */
  getTimeUntilOpen(): { hours: number; minutes: number } | null {
    if (this.isMarketOpen()) {
      return null;
    }
    
    const now = this.getISTTime();
    const hours = this.exchange === 'MCX' ? MCX_HOURS : NSE_HOURS;
    
    // If before trading hours today and it's a trading day
    const currentTime = this.formatTime(now);
    if (this.isTradingDay(now) && currentTime < hours.trading.start) {
      const [openHour, openMin] = hours.trading.start.split(':').map(Number);
      const [nowHour, nowMin] = currentTime.split(':').map(Number);
      
      let diffMinutes = (openHour * 60 + openMin) - (nowHour * 60 + nowMin);
      
      return {
        hours: Math.floor(diffMinutes / 60),
        minutes: diffMinutes % 60,
      };
    }
    
    // Otherwise, calculate to next trading day
    const nextDay = this.getNextTradingDay(now);
    const [openHour, openMin] = hours.trading.start.split(':').map(Number);
    
    nextDay.setHours(openHour, openMin, 0, 0);
    const diffMs = nextDay.getTime() - now.getTime();
    const diffMinutes = Math.floor(diffMs / 60000);
    
    return {
      hours: Math.floor(diffMinutes / 60),
      minutes: diffMinutes % 60,
    };
  }
  
  /**
   * Get time until market closes
   */
  getTimeUntilClose(): { hours: number; minutes: number } | null {
    if (!this.isMarketOpen()) {
      return null;
    }
    
    const now = this.getISTTime();
    const hours = this.exchange === 'MCX' ? MCX_HOURS : NSE_HOURS;
    
    const currentTime = this.formatTime(now);
    const [closeHour, closeMin] = hours.trading.end.split(':').map(Number);
    const [nowHour, nowMin] = currentTime.split(':').map(Number);
    
    let diffMinutes = (closeHour * 60 + closeMin) - (nowHour * 60 + nowMin);
    
    return {
      hours: Math.floor(diffMinutes / 60),
      minutes: diffMinutes % 60,
    };
  }
  
  /**
   * Get trading hours for exchange
   */
  getTradingHours(): TradingHours {
    return this.exchange === 'MCX' ? MCX_HOURS : NSE_HOURS;
  }
  
  /**
   * Get upcoming holidays
   */
  getUpcomingHolidays(count: number = 5): string[] {
    const today = this.formatDate(new Date());
    return NSE_HOLIDAYS
      .filter(h => h >= today)
      .slice(0, count);
  }
  
  /**
   * Get IST time
   */
  private getISTTime(): Date {
    // Simple IST offset (UTC+5:30)
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    return new Date(utc + (5.5 * 60 * 60000));
  }
  
  /**
   * Format time as HH:MM
   */
  private formatTime(date: Date): string {
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  }
  
  /**
   * Format date as YYYY-MM-DD
   */
  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }
  
  /**
   * Check if time is in range
   */
  private isTimeInRange(current: string, start: string, end: string): boolean {
    return current >= start && current <= end;
  }
  
  /**
   * Get market status summary
   */
  getMarketStatus(): {
    exchange: Exchange;
    session: MarketSession;
    isOpen: boolean;
    tradingHours: TradingHours;
    timeUntilOpen?: { hours: number; minutes: number };
    timeUntilClose?: { hours: number; minutes: number };
  } {
    const session = this.getCurrentSession();
    
    return {
      exchange: this.exchange,
      session,
      isOpen: session === 'TRADING',
      tradingHours: this.getTradingHours(),
      timeUntilOpen: this.getTimeUntilOpen() || undefined,
      timeUntilClose: this.getTimeUntilClose() || undefined,
    };
  }
}

export default IndianMarketCalendar;

