import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import {
  CardCatalogRepository,
  CollectionRepository,
  LocalCollectionRepository,
  StaticCardCatalogRepository,
} from './core/repositories';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    { provide: CardCatalogRepository, useExisting: StaticCardCatalogRepository },
    { provide: CollectionRepository, useExisting: LocalCollectionRepository },
  ],
};
