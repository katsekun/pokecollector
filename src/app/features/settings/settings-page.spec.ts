import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CollectionStore } from '../../core/collection-store';
import { FirebaseAuthService } from '../../core/firebase-auth';
import { FirebaseCloudSync, SyncConflictReview } from '../../core/firebase-cloud-sync';
import { SettingsPage } from './settings-page';

describe('Sync settings', () => {
  const automatic = signal(true);
  const user = signal<{ uid: string; email: string } | null>(null);
  const status = signal('local');
  const blocked = signal(false);
  const conflict = signal<SyncConflictReview | null>(null);
  const synchronize = vi.fn();
  const resolveConflicts = vi.fn();
  const setAutoSync = vi.fn((enabled: boolean) => automatic.set(enabled));

  beforeEach(() => {
    automatic.set(true);
    user.set(null);
    status.set('local');
    blocked.set(false);
    conflict.set(null);
    synchronize.mockClear();
    resolveConflicts.mockClear();
    setAutoSync.mockClear();
    TestBed.configureTestingModule({
      imports: [SettingsPage],
      providers: [
        { provide: FirebaseAuthService, useValue: { _user: user } },
        {
          provide: CollectionStore,
          useValue: {
            _isLoading: signal(false),
            _storageBlocked: blocked,
            _catalogError: signal(''),
            _allSpecies: signal([]),
          },
        },
        {
          provide: FirebaseCloudSync,
          useValue: {
            _autoSync: automatic,
            _status: status,
            _lastSyncedAt: signal(null),
            _settingError: signal(''),
            _conflict: conflict,
            setAutoSync,
            syncNow: synchronize,
            resolveConflicts,
          },
        },
      ],
    });
  });

  it('updates the per-device checkbox and disables manual sync without a session', async () => {
    const fixture = TestBed.createComponent(SettingsPage);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const checkbox = element.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const button = element.querySelector('button') as HTMLButtonElement;
    expect(checkbox.checked).toBe(true);
    expect(button.disabled).toBe(true);
    checkbox.click();
    await fixture.whenStable();
    expect(setAutoSync).toHaveBeenCalledWith(false);
    expect(checkbox.checked).toBe(false);
    expect(synchronize).not.toHaveBeenCalled();
  });

  it('allows a signed-in user to sync manually while automatic sync is off', async () => {
    user.set({ uid: 'owner', email: 'owner@example.test' });
    automatic.set(false);
    status.set('paused');
    const fixture = TestBed.createComponent(SettingsPage);
    await fixture.whenStable();
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    button.click();
    expect(synchronize).toHaveBeenCalledOnce();
    status.set('connecting');
    await fixture.whenStable();
    expect(button.disabled).toBe(true);
    status.set('paused');
    blocked.set(true);
    await fixture.whenStable();
    expect(button.disabled).toBe(true);
  });
  it('requires an explicit choice for every conflict and clears choices on refresh', async () => {
    user.set({ uid: 'owner', email: 'owner@example.test' });
    const localAlbum = { id: 'one', name: 'Local', speciesIds: [] };
    const cloudAlbum = { id: 'one', name: 'Nube', speciesIds: [] };
    const review: SyncConflictReview = {
      uid: 'owner',
      local: { entries: [], albums: [localAlbum] },
      cloud: { entries: [], albums: [cloudAlbum] },
      plan: {
        data: { entries: [], albums: [] },
        conflicts: [
          { key: 'album:one', kind: 'album', id: 'one', local: localAlbum, cloud: cloudAlbum },
          {
            key: 'album:two',
            kind: 'album',
            id: 'two',
            local: null,
            cloud: { id: 'two', name: 'Otro', speciesIds: [] },
          },
        ],
      },
    };
    conflict.set(review);
    const fixture = TestBed.createComponent(SettingsPage);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const apply = [...element.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Aplicar decisiones'),
    )!;
    const radios = element.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    expect(apply.disabled).toBe(true);
    expect([...radios].every((radio) => !radio.checked)).toBe(true);
    radios[0].click();
    await fixture.whenStable();
    expect(apply.disabled).toBe(true);
    radios[3].click();
    await fixture.whenStable();
    expect(apply.disabled).toBe(false);
    apply.click();
    expect(resolveConflicts).toHaveBeenCalledWith({ 'album:one': 'local', 'album:two': 'cloud' });
    conflict.set({ ...review });
    await fixture.whenStable();
    expect(apply.disabled).toBe(true);
    expect(
      [...element.querySelectorAll<HTMLInputElement>('input[type="radio"]')].every(
        (radio) => !radio.checked,
      ),
    ).toBe(true);
  });
});
