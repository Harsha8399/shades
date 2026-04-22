import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, LineChart, Layers, Activity, Brain, Play } from 'lucide-react';
import clsx from 'clsx';
import { NotificationBanner } from './NotificationBanner';

interface LayoutProps {
  children: ReactNode;
}

const navItems = [
  { path: '/', icon: LayoutDashboard, label: 'Overview' },
  { path: '/trades', icon: Activity, label: 'Trades' },
  { path: '/patterns', icon: Layers, label: 'Patterns' },
  { path: '/paper-trading', icon: Play, label: 'Paper Trading' },
  { path: '/analysis', icon: Brain, label: 'AI Analysis' },
];

export function Layout({ children }: LayoutProps) {
  const location = useLocation();

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-64 bg-bg-secondary border-r border-slate-700/50 flex flex-col">
        {/* Logo */}
        <div className="p-6 border-b border-slate-700/50">
          <h1 className="text-2xl font-display font-bold text-white flex items-center gap-2">
            <LineChart className="text-accent" size={28} />
            Shades
          </h1>
          <p className="text-xs text-slate-500 mt-1">Trading Research Platform</p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4">
          <ul className="space-y-2">
            {navItems.map(({ path, icon: Icon, label }) => (
              <li key={path}>
                <Link
                  to={path}
                  className={clsx(
                    'flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200',
                    location.pathname === path
                      ? 'bg-accent text-white'
                      : 'text-slate-400 hover:bg-bg-tertiary hover:text-white'
                  )}
                >
                  <Icon size={20} />
                  <span className="font-medium">{label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/* Status */}
        <div className="p-4 border-t border-slate-700/50">
          <div className="flex items-center gap-2 text-sm">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
            <span className="text-slate-400">Paper Trading Active</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {/* Top Bar */}
        <header className="h-16 border-b border-slate-700/50 bg-bg-secondary/50 backdrop-blur-sm flex items-center justify-between px-8 sticky top-0 z-30">
          <div className="text-sm text-slate-400">
            {new Date().toLocaleDateString('en-IN', { 
              weekday: 'long', 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            })}
          </div>
          <div className="flex items-center gap-4">
            <NotificationBanner />
          </div>
        </header>
        
        <div className="p-8">
          {children}
        </div>
      </main>
    </div>
  );
}

