/**
 * Notification Service
 * 
 * In-app notification system for trading signals and alerts.
 * Provides a queue-based notification system that can be polled
 * by the frontend dashboard.
 */
import { Signal, Trade } from '../types';

/**
 * Notification types
 */
export type NotificationType = 
  | 'SIGNAL'           // New trading signal detected
  | 'TRADE_OPENED'     // Trade was opened
  | 'TRADE_CLOSED'     // Trade hit target
  | 'TRADE_STOPPED'    // Trade hit stop-loss
  | 'PARTIAL_EXIT'     // Partial profit taken
  | 'TRAILING_STOP'    // Trailing stop updated
  | 'MARKET_ALERT'     // Market condition alert
  | 'SYSTEM';          // System notification

/**
 * Notification priority
 */
export type NotificationPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/**
 * Notification structure
 */
export interface Notification {
  id: string;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  message: string;
  data?: Record<string, any>;
  timestamp: Date;
  read: boolean;
  sound?: string;  // Sound file to play
}

/**
 * Notification filter options
 */
export interface NotificationFilter {
  types?: NotificationType[];
  priority?: NotificationPriority;
  unreadOnly?: boolean;
  since?: Date;
  limit?: number;
}

/**
 * Notification Service class
 */
export class NotificationService {
  private static instance: NotificationService;
  
  private notifications: Notification[] = [];
  private maxNotifications: number = 1000;
  private listeners: ((notification: Notification) => void)[] = [];
  
  private constructor() {}
  
  /**
   * Get singleton instance
   */
  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }
  
  /**
   * Generate notification ID
   */
  private generateId(): string {
    return `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Add a notification
   */
  private addNotification(notification: Omit<Notification, 'id' | 'timestamp' | 'read'>): Notification {
    const fullNotification: Notification = {
      ...notification,
      id: this.generateId(),
      timestamp: new Date(),
      read: false,
    };
    
    this.notifications.unshift(fullNotification);
    
    // Trim if over limit
    if (this.notifications.length > this.maxNotifications) {
      this.notifications = this.notifications.slice(0, this.maxNotifications);
    }
    
    // Notify listeners
    this.listeners.forEach(listener => listener(fullNotification));
    
    // Log notification
    console.log(`[Notification] ${notification.priority} - ${notification.title}: ${notification.message}`);
    
    return fullNotification;
  }
  
  /**
   * Notify about a new signal
   */
  notifySignal(signal: Signal): Notification {
    const direction = signal.direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
    
    return this.addNotification({
      type: 'SIGNAL',
      priority: 'HIGH',
      title: `New Signal: ${signal.symbol}`,
      message: `${direction} @ ₹${signal.entryPrice.toFixed(2)} | SL: ₹${signal.stopLoss.toFixed(2)} | TP: ₹${signal.target.toFixed(2)}`,
      data: {
        symbol: signal.symbol,
        direction: signal.direction,
        entryPrice: signal.entryPrice,
        stopLoss: signal.stopLoss,
        target: signal.target,
        patternName: signal.patternName,
        confidence: signal.confidence,
        confluenceFactors: signal.confluenceFactors,
      },
      sound: 'signal.mp3',
    });
  }
  
  /**
   * Notify about trade opened
   */
  notifyTradeOpened(trade: Trade): Notification {
    const direction = trade.direction === 'LONG' ? '🟢' : '🔴';
    
    return this.addNotification({
      type: 'TRADE_OPENED',
      priority: 'MEDIUM',
      title: `Trade Opened: ${trade.symbol}`,
      message: `${direction} ${trade.direction} @ ₹${trade.entryPrice?.toFixed(2) || trade.signalPrice.toFixed(2)}`,
      data: {
        tradeId: trade.id,
        symbol: trade.symbol,
        direction: trade.direction,
        entryPrice: trade.entryPrice,
        quantity: trade.quantity,
      },
      sound: 'open.mp3',
    });
  }
  
  /**
   * Notify about trade closed (target hit)
   */
  notifyTradeClosed(trade: Trade): Notification {
    const pnl = trade.pnl || 0;
    const pnlStr = pnl >= 0 ? `+₹${pnl.toFixed(2)}` : `-₹${Math.abs(pnl).toFixed(2)}`;
    
    return this.addNotification({
      type: 'TRADE_CLOSED',
      priority: 'HIGH',
      title: `Target Hit: ${trade.symbol}`,
      message: `Trade closed with ${pnlStr}`,
      data: {
        tradeId: trade.id,
        symbol: trade.symbol,
        pnl: trade.pnl,
        exitPrice: trade.exitPrice,
      },
      sound: 'win.mp3',
    });
  }
  
  /**
   * Notify about trade stopped
   */
  notifyTradeStopped(trade: Trade): Notification {
    const pnl = trade.pnl || 0;
    const pnlStr = `-₹${Math.abs(pnl).toFixed(2)}`;
    
    return this.addNotification({
      type: 'TRADE_STOPPED',
      priority: 'HIGH',
      title: `Stop-Loss Hit: ${trade.symbol}`,
      message: `Trade stopped with ${pnlStr}`,
      data: {
        tradeId: trade.id,
        symbol: trade.symbol,
        pnl: trade.pnl,
        exitPrice: trade.exitPrice,
      },
      sound: 'loss.mp3',
    });
  }
  
  /**
   * Notify about partial exit
   */
  notifyPartialExit(trade: Trade, exitLevel: string, pnl: number): Notification {
    return this.addNotification({
      type: 'PARTIAL_EXIT',
      priority: 'MEDIUM',
      title: `Partial Exit: ${trade.symbol}`,
      message: `${exitLevel} hit | P&L: +₹${pnl.toFixed(2)}`,
      data: {
        tradeId: trade.id,
        symbol: trade.symbol,
        exitLevel,
        pnl,
      },
    });
  }
  
  /**
   * Notify about trailing stop update
   */
  notifyTrailingStopUpdate(trade: Trade, oldStop: number, newStop: number): Notification {
    return this.addNotification({
      type: 'TRAILING_STOP',
      priority: 'LOW',
      title: `Trailing Stop: ${trade.symbol}`,
      message: `Stop moved from ₹${oldStop.toFixed(2)} to ₹${newStop.toFixed(2)}`,
      data: {
        tradeId: trade.id,
        symbol: trade.symbol,
        oldStop,
        newStop,
      },
    });
  }
  
  /**
   * Notify about market alert
   */
  notifyMarketAlert(title: string, message: string, data?: Record<string, any>): Notification {
    return this.addNotification({
      type: 'MARKET_ALERT',
      priority: 'HIGH',
      title,
      message,
      data,
      sound: 'alert.mp3',
    });
  }
  
  /**
   * Add system notification
   */
  notifySystem(title: string, message: string, priority: NotificationPriority = 'LOW'): Notification {
    return this.addNotification({
      type: 'SYSTEM',
      priority,
      title,
      message,
    });
  }
  
  /**
   * Get notifications with optional filters
   */
  getNotifications(filter?: NotificationFilter): Notification[] {
    let result = [...this.notifications];
    
    if (filter) {
      if (filter.types) {
        result = result.filter(n => filter.types!.includes(n.type));
      }
      
      if (filter.priority) {
        result = result.filter(n => n.priority === filter.priority);
      }
      
      if (filter.unreadOnly) {
        result = result.filter(n => !n.read);
      }
      
      if (filter.since) {
        result = result.filter(n => n.timestamp >= filter.since!);
      }
      
      if (filter.limit) {
        result = result.slice(0, filter.limit);
      }
    }
    
    return result;
  }
  
  /**
   * Get unread count
   */
  getUnreadCount(): number {
    return this.notifications.filter(n => !n.read).length;
  }
  
  /**
   * Mark notification as read
   */
  markAsRead(id: string): void {
    const notification = this.notifications.find(n => n.id === id);
    if (notification) {
      notification.read = true;
    }
  }
  
  /**
   * Mark all as read
   */
  markAllAsRead(): void {
    this.notifications.forEach(n => n.read = true);
  }
  
  /**
   * Delete notification
   */
  deleteNotification(id: string): void {
    this.notifications = this.notifications.filter(n => n.id !== id);
  }
  
  /**
   * Clear all notifications
   */
  clearAll(): void {
    this.notifications = [];
  }
  
  /**
   * Subscribe to new notifications
   */
  subscribe(listener: (notification: Notification) => void): () => void {
    this.listeners.push(listener);
    
    // Return unsubscribe function
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }
  
  /**
   * Get latest notification
   */
  getLatest(): Notification | null {
    return this.notifications[0] || null;
  }
}

export default NotificationService;

