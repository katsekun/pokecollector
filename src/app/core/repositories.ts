import { inject, Injectable, InjectionToken } from '@angular/core';
import { array } from 'zod';
import {
  Card,
  CollectionData,
  createBackup,
  EMPTY_COLLECTION,
  parseBackup,
  PokemonSpecies,
  speciesSchema,
} from './collection';

export interface Catalog {
  readonly species: readonly PokemonSpecies[];
  readonly cards: readonly Card[];
}

export abstract class CardCatalogRepository {
  public abstract load(): Promise<Catalog>;
}

export abstract class CollectionRepository {
  public abstract load(species: readonly PokemonSpecies[], scope?: string): CollectionData;
  public abstract save(data: CollectionData, scope?: string): void;
}

export const BROWSER_STORAGE = new InjectionToken<Storage | null>('browser-storage', {
  providedIn: 'root',
  factory: () => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  },
});

@Injectable({ providedIn: 'root' })
export class StaticCardCatalogRepository extends CardCatalogRepository {
  public override async load(): Promise<Catalog> {
    const readJson = async (path: string): Promise<unknown> => {
      const response = await fetch(path);
      if (!response.ok) throw new Error('No se pudo cargar el catálogo local.');
      return response.json();
    };
    const rawSpecies = await readJson('data/pokemon-species.json');
    const species = array(speciesSchema).parse(rawSpecies);
    const speciesIds = new Set(species.map((pokemon) => pokemon.id));
    if (speciesIds.size !== species.length) {
      throw new Error('El catálogo contiene referencias inválidas.');
    }
    return { species, cards: [] };
  }
}

@Injectable({ providedIn: 'root' })
export class LocalCollectionRepository extends CollectionRepository {
  private readonly storage = inject(BROWSER_STORAGE);
  public static readonly key = 'pokecollector.collection.v1';

  public override load(species: readonly PokemonSpecies[], scope = 'guest'): CollectionData {
    if (!this.storage) throw new Error('El navegador no permite acceder al almacenamiento local.');
    const text = this.storage.getItem(this.scopeKey(scope));
    return text === null ? EMPTY_COLLECTION : parseBackup(text, species);
  }

  public override save(data: CollectionData, scope = 'guest'): void {
    if (!this.storage) throw new Error('El navegador no permite guardar la colección.');
    this.storage.setItem(this.scopeKey(scope), JSON.stringify(createBackup(data)));
  }

  private scopeKey(scope: string): string {
    return scope === 'guest'
      ? LocalCollectionRepository.key
      : `${LocalCollectionRepository.key}:${encodeURIComponent(scope)}`;
  }
}
