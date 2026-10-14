import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useMeetingSummaryCapture } from '../../src/hooks/useMeetingSummaryCapture';

function Harness() {
  const [active, setActive] = useState(false);
  const [finished, setFinished] = useState(false);
  const capture = useMeetingSummaryCapture(active, 'YLM-ABC234', undefined, null, true, {}, {});
  return <><button onClick={() => setActive(true)}>Enter as host</button>
    <button onClick={() => setActive(false)}>Enter as participant</button>
    <button onClick={() => void capture.resume()}>Exercise legacy resume</button>
    <button onClick={async () => { if (await capture.finish() !== '') throw new Error('Unexpected speech'); setFinished(true); }}>Finish</button>
    <p>{finished ? 'Finished without speech' : active ? 'Host mounted' : 'Participant mounted'}</p></>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Harness /></React.StrictMode>);
