/**
 * NotificationBanner Component
 * 
 * Displays in-app notifications for trading signals and alerts.
 * Shows toast notifications that slide in from the top right.
 */
import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface Notification {
  id: string;
  type: string;
  priority: string;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  data?: Record<string, any>;
}

interface NotificationResponse {
  count: number;
  unreadCount: number;
  notifications: Notification[];
}

const API_BASE = 'http://localhost:3001/api';

async function fetchNotifications(limit: number = 10): Promise<NotificationResponse> {
  const response = await fetch(`${API_BASE}/notifications?limit=${limit}`);
  if (!response.ok) throw new Error('Failed to fetch notifications');
  return response.json();
}

async function markAsRead(id: string): Promise<void> {
  await fetch(`${API_BASE}/notifications/${id}/read`, { method: 'POST' });
}

async function markAllRead(): Promise<void> {
  await fetch(`${API_BASE}/notifications/read-all`, { method: 'POST' });
}

export function NotificationBanner() {
  const [showDropdown, setShowDropdown] = useState(false);
  const [newNotification, setNewNotification] = useState<Notification | null>(null);
  const queryClient = useQueryClient();
  
  // Fetch notifications
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => fetchNotifications(20),
    refetchInterval: 5000, // Poll every 5 seconds
  });
  
  // Mark as read mutation
  const markReadMutation = useMutation({
    mutationFn: markAsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
  
  // Mark all as read mutation
  const markAllReadMutation = useMutation({
    mutationFn: markAllRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
  
  // Show toast for new high-priority notifications
  useEffect(() => {
    if (data?.notifications && data.notifications.length > 0) {
      const latest = data.notifications[0];
      const latestTime = new Date(latest.timestamp).getTime();
      const fiveSecondsAgo = Date.now() - 5000;
      
      if (latestTime > fiveSecondsAgo && !latest.read && 
          (latest.priority === 'HIGH' || latest.priority === 'CRITICAL')) {
        setNewNotification(latest);
        
        // Auto-dismiss toast after 5 seconds
        setTimeout(() => {
          setNewNotification(null);
        }, 5000);
      }
    }
  }, [data?.notifications]);
  
  const handleNotificationClick = useCallback((notification: Notification) => {
    if (!notification.read) {
      markReadMutation.mutate(notification.id);
    }
  }, [markReadMutation]);
  
  const dismissToast = () => {
    if (newNotification) {
      markReadMutation.mutate(newNotification.id);
      setNewNotification(null);
    }
  };
  
  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'CRITICAL': return 'text-red-400 bg-red-500/20';
      case 'HIGH': return 'text-amber-400 bg-amber-500/20';
      case 'MEDIUM': return 'text-emerald-400 bg-emerald-500/20';
      default: return 'text-gray-400 bg-gray-500/20';
    }
  };
  
  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'SIGNAL': return '📡';
      case 'TRADE_OPENED': return '🟢';
      case 'TRADE_CLOSED': return '🎯';
      case 'TRADE_STOPPED': return '🛑';
      case 'PARTIAL_EXIT': return '💰';
      case 'TRAILING_STOP': return '↗️';
      case 'MARKET_ALERT': return '⚠️';
      default: return '📌';
    }
  };
  
  const formatTimestamp = (ts: string) => {
    const date = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString();
  };
  
  return (
    <>
      {/* Toast Notification */}
      {newNotification && (
        <div className="fixed top-4 right-4 z-50 animate-slide-in">
          <div 
            className={`max-w-sm p-4 rounded-xl shadow-2xl border ${getPriorityColor(newNotification.priority)} border-opacity-50 backdrop-blur-sm cursor-pointer`}
            onClick={dismissToast}
            style={{ background: 'rgba(26, 26, 46, 0.95)' }}
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl">{getTypeIcon(newNotification.type)}</span>
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold text-white truncate">
                  {newNotification.title}
                </h4>
                <p className="text-sm text-gray-300 truncate">
                  {newNotification.message}
                </p>
              </div>
              <button 
                className="text-gray-400 hover:text-white"
                onClick={(e) => { e.stopPropagation(); dismissToast(); }}
              >
                ×
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Notification Bell */}
      <div className="relative">
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className="relative p-2 text-gray-400 hover:text-white transition-colors"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
              d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          
          {/* Badge */}
          {data && data.unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 text-xs flex items-center justify-center bg-red-500 text-white rounded-full">
              {data.unreadCount > 9 ? '9+' : data.unreadCount}
            </span>
          )}
        </button>
        
        {/* Dropdown */}
        {showDropdown && (
          <>
            {/* Backdrop */}
            <div 
              className="fixed inset-0 z-40" 
              onClick={() => setShowDropdown(false)}
            />
            
            {/* Dropdown Panel */}
            <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto rounded-xl shadow-2xl border border-gray-700 z-50"
              style={{ background: 'rgba(26, 26, 46, 0.98)' }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
                <h3 className="font-semibold text-white">Notifications</h3>
                {data && data.unreadCount > 0 && (
                  <button 
                    className="text-xs text-emerald-400 hover:text-emerald-300"
                    onClick={() => markAllReadMutation.mutate()}
                  >
                    Mark all read
                  </button>
                )}
              </div>
              
              {/* Notification List */}
              <div className="divide-y divide-gray-800">
                {data?.notifications && data.notifications.length > 0 ? (
                  data.notifications.map(notification => (
                    <div 
                      key={notification.id}
                      className={`px-4 py-3 cursor-pointer hover:bg-gray-800/50 transition-colors ${!notification.read ? 'bg-emerald-500/5' : ''}`}
                      onClick={() => handleNotificationClick(notification)}
                    >
                      <div className="flex items-start gap-3">
                        <span className="text-lg">{getTypeIcon(notification.type)}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className={`font-medium truncate ${!notification.read ? 'text-white' : 'text-gray-300'}`}>
                              {notification.title}
                            </h4>
                            {!notification.read && (
                              <span className="w-2 h-2 bg-emerald-400 rounded-full"></span>
                            )}
                          </div>
                          <p className="text-sm text-gray-400 truncate">{notification.message}</p>
                          <p className="text-xs text-gray-500 mt-1">{formatTimestamp(notification.timestamp)}</p>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="px-4 py-8 text-center text-gray-500">
                    <p>No notifications</p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

export default NotificationBanner;

