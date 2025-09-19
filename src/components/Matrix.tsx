// matrix.tsx
// Lightweight matrix renderer: sticky headers, keyboard nav, and a render prop for cell content.

import * as React from "react";
import type { Matrix } from "../ref"; // adjust relative path to ref.ts

type Props = {
  matrix: Matrix;
  onCellClick?: (rowKey: string, colKey: string) => void;
  renderCell?: (cell: Matrix["cells"][string]) => React.ReactNode;
  className?: string;
};

export default function MatrixView({
  matrix,
  onCellClick,
  renderCell,
  className
}: Props) {
  const { rows, cols, cells } = matrix;

  return (
    <div
      className={className}
      style={{
        overflow: "auto",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        maxHeight: 480
      }}
      role="grid"
      aria-rowcount={rows.length + 1}
      aria-colcount={cols.length + 1}
      tabIndex={0}
    >
      <table
        style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%" }}
      >
        <thead>
          <tr>
            <th
              style={{
                position: "sticky",
                top: 0,
                left: 0,
                background: "white",
                zIndex: 2,
                padding: "6px 10px",
                borderBottom: "1px solid #e5e7eb"
              }}
            >
              domain \\ tag
            </th>
            {cols.map((c) => (
              <th
                key={c}
                style={{
                  position: "sticky",
                  top: 0,
                  background: "white",
                  zIndex: 1,
                  padding: "6px 10px",
                  borderBottom: "1px solid #e5e7eb",
                  textAlign: "left",
                  whiteSpace: "nowrap"
                }}
                scope="col"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r}>
              <th
                style={{
                  position: "sticky",
                  left: 0,
                  background: "white",
                  zIndex: 1,
                  padding: "6px 10px",
                  borderRight: "1px solid #f1f5f9",
                  textAlign: "left",
                  whiteSpace: "nowrap"
                }}
                scope="row"
              >
                {r}
              </th>
              {cols.map((c) => {
                const key = `${r}::${c}`;
                const cell = cells[key] ?? { rowKey: r, colKey: c, refs: [], score: 0 };
                return (
                  <td
                    key={key}
                    onClick={() => onCellClick?.(r, c)}
                    style={{
                      padding: "6px 10px",
                      borderTop: "1px solid #f8fafc",
                      borderRight: "1px solid #f8fafc",
                      cursor: onCellClick ? "pointer" : "default",
                      userSelect: "none"
                    }}
                    aria-label={`cell ${r} ${c}`}
                  >
                    {renderCell ? renderCell(cell) : (
                      <>
                        <div style={{ fontVariantNumeric: "tabular-nums" }}>{cell.score}</div>
                        <div style={{ fontSize: 11, opacity: 0.65 }}>{cell.refs.length} ref(s)</div>
                      </>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
