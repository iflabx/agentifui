export const CSV_INPUT_BYTES = 128 * 1024;
const MAX_ROWS = 200;
const MAX_COLUMNS = 20;
const MAX_CELL = 2000;

export function parseResultCsv(input: string, inputTruncated = false) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let fieldStart = true;
  let column = 0;
  let bytes = 0;
  let truncated = inputTruncated;
  let rowStarted = false;

  const finishCell = () => {
    if (column < MAX_COLUMNS) row.push(cell);
    else truncated = true;
    column += 1;
    cell = '';
    fieldStart = true;
  };
  const finishRow = () => {
    finishCell();
    rows.push(row);
    row = [];
    column = 0;
    rowStarted = false;
  };

  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const code = text.charCodeAt(index);
    bytes +=
      code < 0x80
        ? 1
        : code < 0x800
          ? 2
          : code >= 0xdc00 && code <= 0xdfff
            ? 1
            : 3;
    if (bytes > CSV_INPUT_BYTES || rows.length === MAX_ROWS) {
      truncated = true;
      break;
    }
    rowStarted = true;
    if (quoted && character === '"') {
      quoted = false;
      fieldStart = false;
    } else if (character === '"' && (fieldStart || text[index - 1] === '"')) {
      quoted = true;
      if (!fieldStart && column < MAX_COLUMNS) {
        if (cell.length < MAX_CELL) cell += '"';
        else truncated = true;
      }
      fieldStart = false;
    } else if (!quoted && character === ',') {
      finishCell();
    } else if (!quoted && (character === '\n' || character === '\r')) {
      finishRow();
      if (character === '\r' && text[index + 1] === '\n') {
        index += 1;
        bytes += 1;
      }
    } else {
      fieldStart = false;
      if (column < MAX_COLUMNS && cell.length < MAX_CELL) cell += character;
      else truncated = true;
    }
  }
  if (rowStarted && rows.length < MAX_ROWS) finishRow();
  return { rows, truncated };
}
