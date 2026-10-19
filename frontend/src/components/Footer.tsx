'use client';

import React from 'react';

export const Footer: React.FC = () => {
  return (
    <footer role="contentinfo" className="w-full border-t border-slate-200 bg-white px-4 sm:px-8 py-2">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-[10px] font-medium text-slate-400">
        <div className="flex items-center gap-2">
          <span>© 2026 YLAAM-MEET • ALL RIGHTS RESERVED</span>
        </div>

        <div className="flex items-center gap-6 uppercase tracking-widest text-slate-400">
          <a href="/privacy-policy" className="hover:text-slate-600 transition-colors">
            Privacy Policy
          </a>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
