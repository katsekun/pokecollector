import { afterRenderEffect, Component, ElementRef, input, viewChild } from '@angular/core';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpFromLine,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  FolderHeart,
  Heart,
  LayoutGrid,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trash2,
  X,
  ZoomIn,
  createElement,
} from 'lucide';

const icons = {
  download: ArrowDownToLine,
  back: ArrowLeft,
  swap: ArrowLeftRight,
  arrow: ArrowRight,
  upload: ArrowUpFromLine,
  book: BookOpen,
  check: Check,
  down: ChevronDown,
  previous: ChevronLeft,
  next: ChevronRight,
  owned: CircleCheck,
  album: FolderHeart,
  heart: Heart,
  grid: LayoutGrid,
  moon: Moon,
  edit: Pencil,
  plus: Plus,
  refresh: RefreshCw,
  search: Search,
  settings: Settings,
  filters: SlidersHorizontal,
  sparkle: Sparkles,
  sun: Sun,
  trash: Trash2,
  close: X,
  zoom: ZoomIn,
};

@Component({
  selector: 'app-icon',
  template: '<span #container aria-hidden="true"></span>',
  styles:
    ':host { display: inline-flex; flex: 0 0 auto; width: 1.15rem; height: 1.15rem; } span, svg { display: block; width: 100%; height: 100%; }',
})
export class Icon {
  public readonly _name = input.required<keyof typeof icons>({ alias: 'name' });
  private readonly _container = viewChild.required<ElementRef<HTMLSpanElement>>('container');

  public constructor() {
    afterRenderEffect(() => {
      this._container().nativeElement.replaceChildren(
        createElement(icons[this._name()], {
          width: '100%',
          height: '100%',
          'stroke-width': 1.7,
          'aria-hidden': 'true',
        }),
      );
    });
  }
}
