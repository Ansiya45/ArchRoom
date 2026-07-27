'use client';

import React from 'react';
import { Home, CalendarPlus, CalendarDays, Star, Settings } from 'lucide-react';

export type SidebarTab = 'home' | 'create' | 'scheduled' | 'favorite' | 'settings';

interface SidebarProps {
  activeTab: SidebarTab;
  setActiveTab: (tab: SidebarTab) => void;
}

interface NavItem {
  id: SidebarTab;
  label: string;
  icon: React.ElementType;
}

const SidebarButton: React.FC<{
  item: NavItem;
  isActive: boolean;
  onClick: () => void;
}> = ({ item, isActive, onClick }) => {
  const Icon = item.icon;

  return (
    <button
      onClick={onClick}
      title={item.label}
      aria-label={item.label}
      className={`relative group p-3 rounded-xl transition-all duration-200 flex items-center justify-center cursor-pointer ${
        isActive
          ? 'bg-blue-50 text-blue-600 font-bold'
          : 'text-slate-400 hover:text-blue-600 hover:bg-slate-50'
      }`}
    >
      <div className="relative w-6 h-6 flex items-center justify-center">
        <Icon
          className={`w-5 h-5 transition-colors ${
            isActive ? 'text-blue-600' : 'text-slate-400 group-hover:text-blue-600'
          }`}
        />
      </div>

      {/* Tooltip on hover */}
      <span className="absolute left-full ml-3 px-2.5 py-1 bg-slate-900 text-white text-xs font-medium rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 shadow-md z-50">
        {item.label}
      </span>
    </button>
  );
};

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab }) => {
  const topNavItems: NavItem[] = [
    {
      id: 'home',
      label: 'Home',
      icon: Home,
    },
    {
      id: 'create',
      label: 'Create Meeting',
      icon: CalendarPlus,
    },
    {
      id: 'scheduled',
      label: 'Scheduled Meetings',
      icon: CalendarDays,
    },
    {
      id: 'favorite',
      label: 'Favorites',
      icon: Star,
    },
  ];

  const settingsItem: NavItem = {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
  };

  return (
    <aside className="fixed left-0 top-[56px] bottom-0 z-30 w-[72px] bg-white border-r border-slate-200 flex flex-col items-center justify-between py-6 shadow-2xs hidden sm:flex">
      {/* Top Navigation Icon Buttons */}
      <div className="flex flex-col items-center gap-6 w-full px-2">
        <nav className="flex flex-col items-center gap-4 w-full">
          {topNavItems.map((item) => (
            <SidebarButton
              key={item.id}
              item={item}
              isActive={activeTab === item.id}
              onClick={() => setActiveTab(item.id)}
            />
          ))}
        </nav>
      </div>

      {/* Bottom Settings Icon Button */}
      <div className="flex flex-col items-center w-full px-2">
        <SidebarButton
          item={settingsItem}
          isActive={activeTab === 'settings'}
          onClick={() => setActiveTab('settings')}
        />
      </div>
    </aside>
  );
};

export default Sidebar;
