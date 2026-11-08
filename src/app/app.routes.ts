import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./features/pokedex/pokedex-page').then((module) => module.PokedexPage),
    title: 'Mi Pokédex · Pokecollector',
  },
  {
    path: 'deseos',
    loadComponent: () =>
      import('./features/pokedex/pokedex-page').then((module) => module.PokedexPage),
    data: { view: 'wishlist' },
    title: 'Lista de deseos · Pokecollector',
  },
  {
    path: 'pokemon/:id',
    loadComponent: () =>
      import('./features/card-detail/card-detail-page').then((module) => module.CardDetailPage),
    title: 'Ficha de carta · Pokecollector',
  },
  {
    path: 'albumes',
    loadComponent: () =>
      import('./features/albums/albums-page').then((module) => module.AlbumsPage),
    title: 'Mis álbumes · Pokecollector',
  },
  {
    path: 'configuracion',
    loadComponent: () =>
      import('./features/settings/settings-page').then((module) => module.SettingsPage),
    title: 'Configuración · Pokecollector',
  },
  { path: '**', redirectTo: '' },
];
