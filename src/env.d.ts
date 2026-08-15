/// <reference types="vite/client" />

interface TrailbookAndroidOpenFile {
  kind: 'file';
  name: string;
  type: string;
  base64: string;
}

interface TrailbookAndroidOpenError {
  kind: 'error';
  code: string;
}

type TrailbookAndroidOpen = TrailbookAndroidOpenFile | TrailbookAndroidOpenError;

interface Window {
  __trailbookAndroidOpenQueue?: TrailbookAndroidOpen[];
  trailbookReceiveAndroidOpen?: (payload: TrailbookAndroidOpen) => void;
}
