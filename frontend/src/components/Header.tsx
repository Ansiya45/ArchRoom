'use client';

import React, { useState } from 'react';
import { LogIn, UserPlus, Menu, X, User, LogOut, Sparkles } from 'lucide-react';

interface HeaderProps {
  onOpenJoin?: () => void;
  onOpenCreate?: () => void;
  onOpenAuth?: (mode: 'login' | 'signup') => void;
  user?: { name: string; email: string; isLoggedIn: boolean } | null;
  onLogout?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenJoin,
  onOpenCreate,
  onOpenAuth,
  user,
  onLogout,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full bg-white/80 backdrop-blur-md border-b border-slate-200 px-4 sm:px-8 py-2.5 flex items-center justify-between transition-all duration-200 h-14">
      <div className="max-w-7xl mx-auto w-full flex items-center justify-between">
        {/* Left: Brand Logo */}
        <div
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="flex items-center gap-2 cursor-pointer group"
        >
          <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center text-white shadow-xs group-hover:scale-105 transition-transform">
            <svg
              className="w-3.5 h-3.5 fill-current"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M12 2L2 22h5l2.5-5h5l2.5 5h5L12 2zm0 6l2.8 5.6h-5.6L12 8z" />
            </svg>
          </div>
          <span className="text-lg font-bold tracking-tight text-slate-900 italic group-hover:text-blue-600 transition-colors">
            ArchRoom
          </span>
        </div>

        {/* Desktop Navigation / User Profile */}
        <div className="hidden md:flex items-center gap-3">
          {user && user.isLoggedIn ? (
            <div className="relative">
              <button
                onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-200 hover:border-blue-300 bg-slate-50 transition-colors cursor-pointer"
              >
                <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">
                  {user.name.charAt(0)}
                </div>
                <span className="text-xs font-semibold text-slate-800">{user.name}</span>
              </button>

              {userDropdownOpen && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-2xl shadow-xl border border-slate-100 py-2 z-50 text-xs">
                  <div className="px-4 py-2 border-b border-slate-100">
                    <div className="font-bold text-slate-900 truncate">{user.name}</div>
                    <div className="text-[11px] text-slate-400 truncate">{user.email}</div>
                  </div>
                  <button
                    onClick={() => {
                      setUserDropdownOpen(false);
                      onLogout?.();
                    }}
                    className="w-full px-4 py-2 text-left text-red-600 hover:bg-red-50 font-medium flex items-center gap-2 cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <button
                onClick={() => onOpenAuth?.('login')}
                className="px-4 py-1.5 text-xs sm:text-sm font-medium text-slate-600 hover:text-blue-600 transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Login</span>
              </button>

              <button
                onClick={() => onOpenAuth?.('signup')}
                className="px-5 py-1.5 text-xs sm:text-sm font-semibold bg-blue-600 text-white rounded-full shadow-md shadow-blue-200 hover:bg-blue-700 transition-all flex items-center gap-1.5 cursor-pointer active:scale-98"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Sign Up</span>
              </button>
            </>
          )}
        </div>

        {/* Mobile Menu Button */}
        <div className="md:hidden flex items-center gap-2">
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2.5 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
            aria-label="Toggle mobile menu"
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Dropdown Menu */}
      {mobileMenuOpen && (
        <div className="absolute top-full left-0 right-0 border-b border-slate-200 bg-white/95 backdrop-blur-md px-6 py-4 space-y-3 shadow-lg md:hidden">
          <div className="flex flex-col gap-2.5">
            {user && user.isLoggedIn ? (
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  onLogout?.();
                }}
                className="w-full py-2.5 text-sm font-medium text-red-600 border border-red-200 rounded-xl flex items-center justify-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                Sign Out ({user.name})
              </button>
            ) : (
              <>
                <button
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onOpenAuth?.('login');
                  }}
                  className="w-full py-2.5 text-sm font-medium text-slate-600 hover:text-blue-600 border border-slate-200 rounded-xl flex items-center justify-center gap-2"
                >
                  <LogIn className="w-4 h-4" />
                  Login
                </button>
                <button
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onOpenAuth?.('signup');
                  }}
                  className="w-full py-2.5 text-sm font-semibold bg-blue-600 text-white rounded-full shadow-md shadow-blue-200 flex items-center justify-center gap-2"
                >
                  <UserPlus className="w-4 h-4" />
                  Sign Up
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
};

export default Header;
