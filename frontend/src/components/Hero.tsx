'use client';

import React from 'react';
import HeroContent from './HeroContent';
import MeetingCard from './MeetingCard';

interface HeroProps {
  onJoinMeeting: () => void;
  onCreateMeeting: () => void;
  currentMeeting?: {
    title: string;
    code: string;
    hostName: string;
    isLive: boolean;
  } | null;
  onLeaveMeeting?: () => void;
}

export const Hero: React.FC<HeroProps> = ({
  onJoinMeeting,
  onCreateMeeting,
  currentMeeting,
  onLeaveMeeting,
}) => {
  return (
    <section className="relative w-full h-full flex items-center py-2 lg:py-4 px-4 sm:px-6 lg:px-10 max-w-7xl mx-auto my-auto">
      {/* Two-Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
        {/* Left Column: Hero Content */}
        <div className="lg:col-span-5">
          <HeroContent
            onJoinMeeting={onJoinMeeting}
            onCreateMeeting={onCreateMeeting}
          />
        </div>

        {/* Right Column: Meeting Card Preview */}
        <div className="lg:col-span-7 relative flex justify-center">
          <div className="relative w-full">
            <MeetingCard
              currentMeeting={currentMeeting}
              onLeaveMeeting={onLeaveMeeting}
            />
          </div>
        </div>
      </div>
    </section>
  );
};

export default Hero;
