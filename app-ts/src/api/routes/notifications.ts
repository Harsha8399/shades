/**
 * API routes for notifications
 */
import { Router, Request, Response } from 'express';
import { NotificationService, NotificationFilter, NotificationType, NotificationPriority } from '../../notifications/NotificationService';

const router = Router();
const notificationService = NotificationService.getInstance();

/**
 * GET /notifications
 * Get notifications with optional filters
 * Query params:
 *   - types: comma-separated list of types
 *   - priority: filter by priority
 *   - unreadOnly: 'true' to get only unread
 *   - since: ISO date string
 *   - limit: number of notifications
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const filter: NotificationFilter = {};
    
    if (req.query.types) {
      filter.types = (req.query.types as string).split(',') as NotificationType[];
    }
    
    if (req.query.priority) {
      filter.priority = req.query.priority as NotificationPriority;
    }
    
    if (req.query.unreadOnly === 'true') {
      filter.unreadOnly = true;
    }
    
    if (req.query.since) {
      filter.since = new Date(req.query.since as string);
    }
    
    if (req.query.limit) {
      filter.limit = parseInt(req.query.limit as string, 10);
    }
    
    const notifications = notificationService.getNotifications(filter);
    
    res.json({
      count: notifications.length,
      unreadCount: notificationService.getUnreadCount(),
      notifications: notifications.map(n => ({
        ...n,
        timestamp: n.timestamp.toISOString(),
      })),
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

/**
 * GET /notifications/unread-count
 * Get count of unread notifications
 */
router.get('/unread-count', async (req: Request, res: Response): Promise<void> => {
  try {
    const count = notificationService.getUnreadCount();
    res.json({ count });
  } catch (error) {
    console.error('Error getting unread count:', error);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

/**
 * GET /notifications/latest
 * Get the most recent notification
 */
router.get('/latest', async (req: Request, res: Response): Promise<void> => {
  try {
    const notification = notificationService.getLatest();
    
    if (!notification) {
      res.json({ notification: null });
      return;
    }
    
    res.json({
      notification: {
        ...notification,
        timestamp: notification.timestamp.toISOString(),
      },
    });
  } catch (error) {
    console.error('Error getting latest notification:', error);
    res.status(500).json({ error: 'Failed to get latest notification' });
  }
});

/**
 * POST /notifications/:id/read
 * Mark notification as read
 */
router.post('/:id/read', async (req: Request, res: Response): Promise<void> => {
  try {
    notificationService.markAsRead(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

/**
 * POST /notifications/read-all
 * Mark all notifications as read
 */
router.post('/read-all', async (req: Request, res: Response): Promise<void> => {
  try {
    notificationService.markAllAsRead();
    res.json({ success: true });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({ error: 'Failed to mark all notifications as read' });
  }
});

/**
 * DELETE /notifications/:id
 * Delete a notification
 */
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    notificationService.deleteNotification(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

/**
 * DELETE /notifications
 * Clear all notifications
 */
router.delete('/', async (req: Request, res: Response): Promise<void> => {
  try {
    notificationService.clearAll();
    res.json({ success: true });
  } catch (error) {
    console.error('Error clearing notifications:', error);
    res.status(500).json({ error: 'Failed to clear notifications' });
  }
});

/**
 * GET /notifications/poll
 * Long-polling endpoint for real-time notifications
 * Returns when new notification arrives or timeout
 */
router.get('/poll', async (req: Request, res: Response): Promise<void> => {
  const timeout = parseInt(req.query.timeout as string, 10) || 30000;
  const since = req.query.since ? new Date(req.query.since as string) : new Date();
  
  let resolved = false;
  
  // Set up listener for new notifications
  const unsubscribe = notificationService.subscribe((notification) => {
    if (!resolved && notification.timestamp > since) {
      resolved = true;
      unsubscribe();
      res.json({
        notification: {
          ...notification,
          timestamp: notification.timestamp.toISOString(),
        },
      });
    }
  });
  
  // Set up timeout
  const timer = setTimeout(() => {
    if (!resolved) {
      resolved = true;
      unsubscribe();
      res.json({ notification: null, timeout: true });
    }
  }, timeout);
  
  // Clean up on client disconnect
  req.on('close', () => {
    if (!resolved) {
      resolved = true;
      unsubscribe();
      clearTimeout(timer);
    }
  });
});

export default router;

