// Keep the video source attached when only microphone tracks or mute state change.
// Published tracks belong to LiveKit; removing them here must never stop them.
export function updateMediaStream(
  previous: MediaStream | undefined,
  video?: MediaStreamTrack,
  audio?: MediaStreamTrack,
): MediaStream {
  if (!previous || previous.getVideoTracks()[0] !== video) {
    return new MediaStream([video, audio].filter((track): track is MediaStreamTrack => !!track));
  }
  for (const track of previous.getAudioTracks()) {
    if (track !== audio) previous.removeTrack(track);
  }
  if (audio && !previous.getAudioTracks().includes(audio)) previous.addTrack(audio);
  return previous;
}
