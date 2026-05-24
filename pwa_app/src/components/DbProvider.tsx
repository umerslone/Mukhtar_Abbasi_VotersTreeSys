'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { offlineVoterDatabase, type OfflineVoterDatabase } from '@/lib/offline-db';
import type { VoterStatus } from '@/lib/types';

interface DatabaseContextValue {
  db: OfflineVoterDatabase;
  ready: boolean;
  error: string | null;
  revision: number;
  reload: () => Promise<void>;
  importDatabase: (file: File) => Promise<void>;
  updateStatus: (id: number, status: VoterStatus) => Promise<void>;
  updateName: (id: number, name: string) => Promise<void>;
  markDutyStaff: (ids: number[]) => Promise<void>;
  downloadDatabase: () => Promise<void>;
}

const DatabaseContext = createContext<DatabaseContextValue | null>(null);

export function DbProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let mounted = true;
    offlineVoterDatabase
      .ensureReady()
      .then(() => {
        if (mounted) {
          setReady(true);
        }
      })
      .catch((reason: unknown) => {
        if (mounted) {
          setError(reason instanceof Error ? reason.message : 'Failed to initialize the offline database.');
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const value = useMemo<DatabaseContextValue>(
    () => ({
      db: offlineVoterDatabase,
      ready,
      error,
      revision,
      reload: async () => {
        await offlineVoterDatabase.ensureReady();
        setRevision((current) => current + 1);
      },
      importDatabase: async (file: File) => {
        await offlineVoterDatabase.importFile(file);
        setReady(true);
        setRevision((current) => current + 1);
      },
      updateStatus: async (id: number, status: VoterStatus) => {
        await offlineVoterDatabase.updateVoterStatus(id, status);
        setRevision((current) => current + 1);
      },
      updateName: async (id: number, name: string) => {
        await offlineVoterDatabase.updateVoterName(id, name);
        setRevision((current) => current + 1);
      },
      markDutyStaff: async (ids: number[]) => {
        await offlineVoterDatabase.markDutyStaff(ids);
        setRevision((current) => current + 1);
      },
      downloadDatabase: async () => {
        const bytes = await offlineVoterDatabase.exportBytes();
        const arrayBuffer = bytes.slice().buffer as ArrayBuffer;
        const blob = new Blob([arrayBuffer], { type: 'application/x-sqlite3' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'voters_db.sqlite';
        link.click();
        URL.revokeObjectURL(url);
      }
    }),
    [error, ready, revision]
  );

  return <DatabaseContext.Provider value={value}>{children}</DatabaseContext.Provider>;
}

export function useDatabase(): DatabaseContextValue {
  const context = useContext(DatabaseContext);
  if (!context) {
    throw new Error('useDatabase must be used inside DbProvider.');
  }
  return context;
}
