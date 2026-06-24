import {
  generateDropInTimeline,
  generatePackingTimeline,
  generateShakeTimeline,
} from './packing';
import type { JobSettings, ModelPart, PackingFrame } from './types';

const LIVE_FRAME_DELAY_MS = 16;

type WorkerSettings = Pick<JobSettings, 'seed' | 'cageEnabled' | 'printer'>;

type PackingWorkerRequest =
  | {
      jobId: number;
      kind: 'pack';
      models: ModelPart[];
      settings: WorkerSettings;
    }
  | {
      jobId: number;
      kind: 'shake';
      models: ModelPart[];
      settings: WorkerSettings;
    }
  | {
      jobId: number;
      kind: 'dropIn';
      existingModels: ModelPart[];
      addedModels: ModelPart[];
      settings: WorkerSettings;
    };

type PackingWorkerResponse =
  | {
      jobId: number;
      frame: PackingFrame;
    }
  | {
      jobId: number;
      finalModels: ModelPart[];
    }
  | {
      jobId: number;
      error: string;
    };

function waitForLiveFrame() {
  return new Promise((resolve) => {
    self.setTimeout(resolve, LIVE_FRAME_DELAY_MS);
  });
}

self.onmessage = (event: MessageEvent<PackingWorkerRequest>) => {
  const request = event.data;
  void (async () => {
    try {
      const timeline =
        request.kind === 'pack'
          ? generatePackingTimeline(request.models, request.settings)
          : request.kind === 'shake'
            ? generateShakeTimeline(request.models, request.settings)
            : generateDropInTimeline(request.existingModels, request.addedModels, request.settings);

      let next = timeline.next();
      while (!next.done) {
        self.postMessage({ jobId: request.jobId, frame: next.value } satisfies PackingWorkerResponse);
        await waitForLiveFrame();
        next = timeline.next();
      }

      self.postMessage({ jobId: request.jobId, finalModels: next.value } satisfies PackingWorkerResponse);
    } catch (error) {
      self.postMessage({
        jobId: request.jobId,
        error: error instanceof Error ? error.message : 'Packing simulation failed',
      } satisfies PackingWorkerResponse);
    }
  })();
};
