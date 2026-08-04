'use client';

import { useParams } from "next/navigation";
import { MeetingRoom } from "@/components/meeting/MeetingRoom";

export default function MeetingPage() {
  const params = useParams();

  const meetingCode =
    typeof params.meetingCode === "string"
      ? params.meetingCode
      : "";

  return <MeetingRoom meetingCode={meetingCode} />;
}