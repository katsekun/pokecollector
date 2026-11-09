import { expect, test, type Page } from '@playwright/test';
import { CollectionData } from '../src/app/core/collection';
import { Group } from '../src/app/core/groups';

test('two accounts share a collection, dissolve it and keep their personal originals', async ({
  page,
  browser,
}, testInfo) => {
  const errors: string[] = [];
  const firestoreRequests: string[] = [];
  const originals: Record<string, CollectionData> = {
    owner: { entries: [], albums: [{ id: 'album', name: 'Owner album', speciesIds: [] }] },
    friend: { entries: [], albums: [{ id: 'album', name: 'Friend album', speciesIds: [] }] },
  };
  let group: Group | null = null;
  let shared: CollectionData = { entries: [], albums: [] };
  let version = 0;
  const groupView = (uid: string) => (group?.memberUids.includes(uid) ? [group] : []);
  const bootstrap = async (target: Page, uid: string) => {
    target.on('pageerror', (error) => errors.push(error.message));
    await target.route('**/firestore.googleapis.com/**', (route) => {
      firestoreRequests.push(route.request().url());
      return route.abort();
    });
    await target.exposeFunction('groupMetadata', () => structuredClone(groupView(uid)));
    await target.exposeFunction('personalLoad', () => structuredClone(originals[uid]));
    await target.exposeFunction('personalSave', (data: CollectionData) => {
      originals[uid] = structuredClone(data);
    });
    await target.exposeFunction('groupLoad', () => {
      if (!group || !group.memberUids.includes(uid)) throw new Error('Access denied');
      return { revision: group.activeRevision, data: structuredClone(shared) };
    });
    await target.exposeFunction(
      'groupSave',
      (
        _id: string,
        _author: string,
        expected: string,
        data: CollectionData,
        contributed: boolean,
      ) => {
        if (!group || group.status === 'closed' || group.activeRevision !== expected)
          throw new Error('El grupo cambió o se cerró.');
        shared = structuredClone(data);
        group = {
          ...group,
          activeRevision: `revision-${++version}`,
          contributedUids: contributed
            ? [...new Set([...group.contributedUids, uid])]
            : group.contributedUids,
        };
        return group.activeRevision;
      },
    );
    await target.exposeFunction('groupCreate', (email: string, data: CollectionData) => {
      shared = structuredClone(data);
      group = {
        id: 'pair',
        ownerUid: uid,
        ownerEmail: `${uid}@gmail.com`,
        invitedEmail: email,
        memberUids: [uid],
        contributedUids: [uid],
        status: 'pending',
        activeRevision: `revision-${++version}`,
      };
    });
    await target.exposeFunction('groupStart', () => {
      if (group && group.invitedEmail === `${uid}@gmail.com` && group.status === 'pending') {
        group = { ...group, memberUids: [...group.memberUids, uid], status: 'active' };
      }
      return structuredClone(groupView(uid));
    });
    await target.exposeFunction('groupClose', () => {
      if (group) group = { ...group, status: 'closed' };
    });
    await target.goto('/');
    await expect(
      target.getByRole('button', { name: 'Entrar con Google', exact: true }),
    ).toBeVisible();
    await expect(target.locator('.specimen')).toHaveCount(24);
    await target.evaluate(`(() => {
      const app = window.ng.getComponent(document.querySelector('app-root'));
      const sync = app.cloudSync;
      const groups = sync.groups;
      sync.repository.load = () => window.personalLoad();
      sync.repository.save = (_uid, data) => window.personalSave(data);
      sync.repository.saveIfUnchanged = (_uid, _expected, data) => window.personalSave(data);
      sync.groupRepository.load = () => window.groupLoad();
      sync.groupRepository.save = (...arguments_) => window.groupSave(...arguments_);
      groups.start = async () => { groups._groups.set(await window.groupStart()); groups._loaded.set(true); };
      groups.create = async (email, data) => { await window.groupCreate(email, data); groups._groups.set(await window.groupMetadata()); };
      groups.close = async () => { await window.groupClose(); groups._groups.set(await window.groupMetadata()); };
      app.auth._user.set({ uid: '${uid}', email: '${uid}@gmail.com', emailVerified: true });
    })()`);
    await expect(
      target.getByText('Colección sincronizada con Firebase.', { exact: false }),
    ).toBeVisible();
    await target.getByRole('link', { name: 'Configuración', exact: true }).click();
  };
  const refreshMetadata = (target: Page) =>
    target.evaluate(`(async () => {
    const groups = window.ng.getComponent(document.querySelector('app-root')).cloudSync.groups;
    groups._groups.set(await window.groupMetadata());
  })()`);
  await bootstrap(page, 'owner');
  await page.getByLabel('Correo Google de la otra persona').fill('friend@gmail.com');
  await page
    .getByRole('checkbox', {
      name: 'Compartir una copia de mis cartas, deseados, álbumes y precios',
    })
    .check();
  await page.getByRole('button', { name: 'Crear agrupación', exact: true }).click();
  await expect(page.getByText('Pendiente de vincular la segunda cuenta')).toBeVisible();

  const context = await browser.newContext({
    viewport: page.viewportSize()!,
    isMobile: testInfo.project.name === 'mobile',
    hasTouch: testInfo.project.name === 'mobile',
  });
  try {
    const friend = await context.newPage();
    await bootstrap(friend, 'friend');
    await refreshMetadata(page);
    await expect(friend.getByText('Dos personas vinculadas')).toBeVisible();
    await expect(friend.getByRole('button', { name: 'Aceptar', exact: true })).toHaveCount(0);
    await friend.getByRole('button', { name: 'Revisar aportación personal', exact: true }).click();
    const confirm = friend.getByRole('button', { name: 'Confirmar aportación', exact: true });
    await expect(confirm).toBeDisabled();
    await friend.locator('app-group-settings input[type="radio"]').first().check();
    await expect(confirm).toBeEnabled();
    await friend.screenshot({ path: testInfo.outputPath('group-review.png'), fullPage: true });
    expect(await friend.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await confirm.click();
    await expect(friend.getByText('Aportación publicada.', { exact: false })).toBeVisible();
    expect(originals.owner.albums[0].name).toBe('Owner album');
    expect(originals.friend.albums[0].name).toBe('Friend album');
    await refreshMetadata(page);
    await refreshMetadata(friend);
    for (const target of [page, friend]) {
      await target.getByRole('button', { name: 'Abrir colección del grupo', exact: true }).click();
      await expect(target.locator('.topbar__label')).toContainText('Colección del grupo');
      await expect(target.getByText('Colección sincronizada', { exact: true })).toBeVisible();
    }
    await page
      .getByRole('navigation')
      .getByRole('link', { name: /Mis álbumes/ })
      .click();
    await page.getByRole('button', { name: 'Renombrar Friend album', exact: true }).click();
    await page.getByLabel('Nombre del álbum', { exact: true }).fill('Shared edit');
    await page.getByRole('button', { name: 'Guardar nombre', exact: true }).click();
    await expect.poll(() => shared.albums[0].name).toBe('Shared edit');
    await refreshMetadata(friend);
    await expect(friend.getByText('Colección sincronizada', { exact: true })).toBeVisible();
    await friend.getByRole('button', { name: 'Disolver agrupación', exact: true }).click();
    await friend.getByRole('button', { name: 'Confirmar disolución', exact: true }).click();
    await refreshMetadata(page);
    await expect(friend.locator('.topbar__label')).toContainText('Mi biblioteca personal');
    await expect(page.locator('.topbar__label')).toContainText('Mi biblioteca personal');
    expect(originals.owner.albums[0].name).toBe('Owner album');
    expect(originals.friend.albums[0].name).toBe('Friend album');
    await expect(friend.getByText('Archivo cerrado:', { exact: false })).toBeVisible();
    await friend.getByRole('button', { name: 'Revisar copia a mi personal', exact: true }).click();
    await friend.locator('app-group-settings input[type="radio"]').nth(1).check();
    await friend
      .getByRole('button', { name: 'Confirmar combinación personal', exact: true })
      .click();
    await expect.poll(() => originals.friend.albums[0].name).toBe('Shared edit');
    expect(originals.owner.albums[0].name).toBe('Owner album');
    await friend.screenshot({ path: testInfo.outputPath('group-archive.png'), fullPage: true });
    expect(await friend.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(firestoreRequests).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
