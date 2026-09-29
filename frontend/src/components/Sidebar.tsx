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

  const allItems = [...topNavItems, settingsItem];

  return <>
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
    <nav aria-label="Mobile dashboard navigation" className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-center justify-around border-t border-slate-200 bg-white px-1 sm:hidden">
      {allItems.map((item) => {
        const Icon = item.icon;
        const selected = activeTab === item.id;
        return <button key={item.id} type="button" aria-label={item.label} aria-current={selected ? 'page' : undefined}
          onClick={() => setActiveTab(item.id)} className={`flex min-w-0 flex-1 flex-col items-center gap-1 py-2 text-[10px] font-semibold ${selected ? 'text-blue-600' : 'text-slate-500'}`}>
          <Icon className="h-4 w-4" />
          <span className="max-w-full truncate">{item.label}</span>
        </button>;
      })}
    </nav>
  </>;
};

export default Sidebar;
