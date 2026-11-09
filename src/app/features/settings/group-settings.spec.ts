import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupSettings } from './group-settings';
import { FirebaseAuthService } from '../../core/firebase-auth';
import { FirebaseCloudSync } from '../../core/firebase-cloud-sync';
import { CollectionStore } from '../../core/collection-store';
import { Groups, Group } from '../../core/groups';
import { GroupCollectionRepository } from '../../core/group-collection';
import { CollectionData } from '../../core/collection';

describe('Group settings workflow', () => {
  const personal = signal<CollectionData>({
    entries: [],
    albums: [{ id: 'album', name: 'Personal', speciesIds: [] }],
  });
  const group: Group = {
    id: 'pair',
    ownerUid: 'owner',
    ownerEmail: 'owner@gmail.com',
    invitedEmail: 'friend@gmail.com',
    memberUids: ['owner', 'friend'],
    contributedUids: ['owner'],
    status: 'active',
    activeRevision: 'first',
  };
  const values = signal<readonly Group[]>([group]);
  const scope = signal('personal:friend');
  const create = vi.fn();
  const close = vi.fn();
  const save = vi.fn(async () => 'next');
  const restore = vi.fn();
  const openCollection = vi.fn(() => true);
  const cloud: CollectionData = {
    entries: [],
    albums: [{ id: 'album', name: 'Grupo', speciesIds: [] }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    values.set([group]);
    scope.set('personal:friend');
    personal.set({ entries: [], albums: [{ id: 'album', name: 'Personal', speciesIds: [] }] });
    save.mockResolvedValue('next');
    restore.mockReturnValue(true);
    TestBed.configureTestingModule({
      imports: [GroupSettings],
      providers: [
        {
          provide: FirebaseAuthService,
          useValue: {
            _user: signal({ uid: 'friend', email: 'friend@gmail.com', emailVerified: true }),
          },
        },
        {
          provide: Groups,
          useValue: {
            _groups: values,
            _current: computed(() => values().find((item) => item.status !== 'closed') ?? null),
            _archives: computed(() => values().filter((item) => item.status === 'closed')),
            _invitations: signal([]),
            _busy: signal(false),
            _error: signal(''),
            _loaded: signal(true),
            start: vi.fn(),
            create,
            close,
            refresh: vi.fn(),
          },
        },
        { provide: FirebaseCloudSync, useValue: { _status: signal('synced'), openCollection } },
        {
          provide: CollectionStore,
          useValue: {
            _scope: scope,
            _collection: personal,
            _allSpecies: signal([]),
            _storageBlocked: signal(false),
            readScope: vi.fn(() => personal()),
            restore,
          },
        },
        {
          provide: GroupCollectionRepository,
          useValue: { load: vi.fn(async () => ({ revision: 'first', data: cloud })), save },
        },
      ],
    });
  });

  async function render() {
    const fixture = TestBed.createComponent(GroupSettings);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const button = (text: string) =>
      [...element.querySelectorAll<HTMLButtonElement>('button')].find(
        (item) => item.textContent?.trim() === text,
      )!;
    return { fixture, element, button };
  }

  it('requires conflict choices before contributing and never restores the personal collection', async () => {
    const { fixture, element, button } = await render();
    button('Revisar aportación personal').click();
    await fixture.whenStable();
    expect(button('Confirmar aportación').disabled).toBe(true);
    element.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1].click();
    await fixture.whenStable();
    button('Confirmar aportación').click();
    await fixture.whenStable();
    expect(save).toHaveBeenCalledWith('pair', 'friend', 'first', cloud, true);
    expect(restore).not.toHaveBeenCalled();
    expect(personal().albums[0].name).toBe('Personal');
    expect(element.textContent).toContain('Aportación publicada');
  });

  it('rejects a review if the personal collection changed', async () => {
    const { fixture, element, button } = await render();
    button('Revisar aportación personal').click();
    await fixture.whenStable();
    element.querySelector<HTMLInputElement>('input[type="radio"]')!.click();
    personal.set({ entries: [], albums: [{ id: 'album', name: 'Editado', speciesIds: [] }] });
    await fixture.whenStable();
    button('Confirmar aportación').click();
    await fixture.whenStable();
    expect(save).not.toHaveBeenCalled();
    expect(element.textContent).toContain('personal cambió');
  });

  it('keeps the review and originals if the shared version changed during publication', async () => {
    save.mockRejectedValueOnce(new Error('El grupo cambió durante el guardado.'));
    const { fixture, element, button } = await render();
    button('Revisar aportación personal').click();
    await fixture.whenStable();
    element.querySelector<HTMLInputElement>('input[type="radio"]')!.click();
    await fixture.whenStable();
    button('Confirmar aportación').click();
    await fixture.whenStable();
    expect(restore).not.toHaveBeenCalled();
    expect(element.textContent).toContain('grupo cambió');
    expect(button('Confirmar aportación')).toBeDefined();
  });

  it('does not dissolve a group before explicit confirmation', async () => {
    const { fixture, button } = await render();
    button('Disolver agrupación').click();
    await fixture.whenStable();
    expect(close).not.toHaveBeenCalled();
    button('Confirmar disolución').click();
    await fixture.whenStable();
    expect(close).toHaveBeenCalledWith('pair');
    expect(restore).not.toHaveBeenCalled();
  });
  it('copies a closed archive only after choosing how to combine it with personal data', async () => {
    values.set([{ ...group, status: 'closed' }]);
    const { fixture, element, button } = await render();
    button('Revisar copia a mi personal').click();
    await fixture.whenStable();
    expect(restore).not.toHaveBeenCalled();
    expect(button('Confirmar combinación personal').disabled).toBe(true);
    element.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1].click();
    await fixture.whenStable();
    button('Confirmar combinación personal').click();
    await fixture.whenStable();
    expect(openCollection).toHaveBeenCalledWith('personal:friend');
    const copied = JSON.parse(restore.mock.calls[0][0]) as CollectionData;
    expect(copied.entries).toEqual(cloud.entries);
    expect(copied.albums).toEqual(cloud.albums);
    expect(save).not.toHaveBeenCalled();
    expect(element.textContent).toContain('Combinación guardada');
  });
});
