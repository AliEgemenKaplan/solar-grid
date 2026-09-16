import { applyDecorators, Type as ClassType } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export const DEFAULT_PAGE_SIZE = 50;
/**
 * Large enough for a dashboard table, small enough that one request cannot
 * ask a service to serialise its whole table.
 */
export const MAX_PAGE_SIZE = 100;
/** Deep offsets are slow and nobody pages this far by hand. */
export const MAX_PAGE = 10_000;

/**
 * `?page=1&limit=50`. Anything outside the bounds is refused with a 400 rather
 * than quietly clamped, so a client asking for 999999 rows learns that it
 * cannot have them instead of silently receiving 100.
 */
export class PaginationQuery {
  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  page: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit: number = DEFAULT_PAGE_SIZE;
}

export interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  /**
   * Total matching rows. Every list here is filtered by an indexed column and
   * the tables are small, so a count is cheap; a table that grew into the
   * millions would move to cursor pagination instead.
   */
  total: number;
}

/** Prisma skip/take for a page. */
export function pageWindow(query: PaginationQuery): { skip: number; take: number } {
  return { skip: (query.page - 1) * query.limit, take: query.limit };
}

export function toPage<T>(items: T[], total: number, query: PaginationQuery): Page<T> {
  return { items, page: query.page, limit: query.limit, total };
}

class PageMeta {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: DEFAULT_PAGE_SIZE })
  limit!: number;

  @ApiProperty({ example: 123 })
  total!: number;
}

/** Documents a `Page<ItemType>` response in OpenAPI. */
export function ApiPageResponse(itemType: ClassType<unknown>, description?: string) {
  return applyDecorators(
    ApiExtraModels(PageMeta, itemType),
    ApiOkResponse({
      description,
      schema: {
        allOf: [
          { $ref: getSchemaPath(PageMeta) },
          {
            properties: {
              items: { type: 'array', items: { $ref: getSchemaPath(itemType) } },
            },
            required: ['items'],
          },
        ],
      },
    }),
  );
}
