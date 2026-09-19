import { useId, useState, type ReactNode } from 'react';
import { ChartIcon, TableIcon } from '../ui/icons';
import { cx } from '../ui/primitives';

export interface LegendItem {
  label: string;
  /** A CSS colour for the key; the label itself stays in text colour. */
  color: string;
  shape: 'line' | 'area' | 'bar' | 'band';
}

export interface TableColumn {
  header: string;
  align?: 'left' | 'right';
}

/**
 * A chart with its legend and its table twin.
 *
 * The table carries every value the chart draws, exactly as the API returned
 * it, so nothing is readable only by hovering or only by telling colours
 * apart. The legend names each series with a word next to its key.
 */
export function ChartFrame({
  label,
  legend,
  columns,
  rows,
  children,
}: {
  /** What the chart shows; used for the table caption and the toggle. */
  label: string;
  legend?: LegendItem[];
  columns: TableColumn[];
  rows: ReactNode[][];
  children: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  const tableId = useId();

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {legend && legend.length > 0 ? (
          <ul
            className="flex flex-wrap items-center gap-x-4 gap-y-1"
            aria-label={`${label} legend`}
          >
            {legend.map((item) => (
              <li key={item.label} className="flex items-center gap-1.5 text-xs text-ink-2">
                <LegendKey color={item.color} shape={item.shape} />
                {item.label}
              </li>
            ))}
          </ul>
        ) : (
          <span />
        )}
        <button
          type="button"
          aria-pressed={asTable}
          aria-controls={asTable ? tableId : undefined}
          onClick={() => setAsTable((value) => !value)}
          className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-ink-2 hover:bg-raised hover:text-ink"
        >
          {asTable ? <ChartIcon /> : <TableIcon />}
          {asTable ? 'Show chart' : 'Show table'}
          <span className="sr-only"> for {label}</span>
        </button>
      </div>

      {asTable ? (
        <div id={tableId} className="max-h-80 overflow-auto rounded-md border border-line">
          <table className="figures w-full min-w-[32rem] border-collapse text-xs">
            <caption className="sr-only">{label}</caption>
            <thead className="sticky top-0 bg-raised">
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.header}
                    scope="col"
                    className={cx(
                      'px-3 py-2 font-medium text-ink-3',
                      column.align === 'right' ? 'text-right' : 'text-left',
                    )}
                  >
                    {column.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-t border-line">
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className={cx(
                        'px-3 py-1.5 text-ink-2',
                        columns[cellIndex]?.align === 'right' ? 'text-right' : 'text-left',
                      )}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </div>
  );
}

function LegendKey({ color, shape }: Pick<LegendItem, 'color' | 'shape'>) {
  if (shape === 'line') {
    return (
      <span
        aria-hidden="true"
        className="inline-block h-0.5 w-3.5 rounded"
        style={{ background: color }}
      />
    );
  }
  if (shape === 'band') {
    return (
      <span
        aria-hidden="true"
        className="inline-block h-2.5 w-3.5 rounded-sm"
        style={{ background: color, opacity: 0.35 }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="inline-block h-2.5 w-2.5 rounded-sm"
      style={{ background: color }}
    />
  );
}
