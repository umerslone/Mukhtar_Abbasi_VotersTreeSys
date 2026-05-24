declare module 'react-window' {
  import * as React from 'react';

  export interface ListChildComponentProps<T = unknown> {
    index: number;
    style: React.CSSProperties;
    data: T;
    isScrolling?: boolean;
  }

  export interface FixedSizeListProps<T = unknown> {
    height: number;
    width: number;
    itemCount: number;
    itemSize: number;
    itemData: T;
    overscanCount?: number;
    children: React.ComponentType<ListChildComponentProps<any>>;
  }

  export const FixedSizeList: React.ComponentType<FixedSizeListProps<any>>;
}
