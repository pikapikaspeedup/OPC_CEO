import type { PaginatedResponse } from './types';

export interface PaginationRequest {
  page: number;
  pageSize: number;
  offset: number;
  limit: number;
}

export interface PaginationConfig {
  defaultPageSize: number;
  maxPageSize: number;
  legacyPageSizeKeys?: string[];
}

function parsePositiveInteger(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
}

export function parsePaginationSearchParams(
  searchParams: URLSearchParams,
  config: PaginationConfig,
): PaginationRequest {
  const page = Math.max(parsePositiveInteger(searchParams.get('page')) || 1, 1);

  const requestedPageSize = [
    searchParams.get('pageSize'),
    ...(config.legacyPageSizeKeys || []).map((key) => searchParams.get(key)),
  ]
    .map((value) => parsePositiveInteger(value))
    .find((value): value is number => typeof value === 'number');

  const pageSize = Math.min(
    Math.max(requestedPageSize || config.defaultPageSize, 1),
    config.maxPageSize,
  );

  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
    limit: pageSize,
  };
}

export function buildPaginatedResponse<T>(
  items: T[],
  total: number,
  pagination: PaginationRequest,
): PaginatedResponse<T> {
  return {
    items,
    page: pagination.page,
    pageSize: pagination.pageSize,
    total,
    hasMore: pagination.offset + items.length < total,
  };
}

export function paginateArray<T>(
  items: readonly T[],
  pagination: PaginationRequest,
): PaginatedResponse<T> {
  const sliced = items.slice(pagination.offset, pagination.offset + pagination.limit);
  return buildPaginatedResponse([...sliced], items.length, pagination);
}
