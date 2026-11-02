/** Non-executing edits inside one exported literal config. Ambiguous JavaScript is manual-only. */
interface Token {
  readonly value: string;
  readonly start: number;
  readonly end: number;
  readonly kind: "string" | "word" | "symbol";
}
const tokensFor = (source: string): Token[] => {
  if (source.length > 1024 * 1024)
    throw new Error("Configuration exceeds safe editing size.");
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    if (/\s/u.test(source[i]!)) {
      i++;
      continue;
    }
    if (source.startsWith("//", i)) {
      i += 2;
      while (i < source.length && !/[\r\n\u2028\u2029]/u.test(source[i]!)) i++;
      continue;
    }
    if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      if (end < 0) throw new Error("Configuration comment is incomplete.");
      i = end + 2;
      continue;
    }
    const start = i;
    const char = source[i]!;
    if (char === "/")
      throw new Error(
        "Regular-expression or division-based configuration requires manual review.",
      );
    if (char === "`")
      throw new Error("Template-based configuration requires manual review.");
    if (char === '"' || char === "'") {
      i++;
      let closed = false;
      while (i < source.length) {
        const next = source[i++]!;
        if (next === "\\") i++;
        else if (next === char) {
          closed = true;
          break;
        }
      }
      if (!closed || i > source.length)
        throw new Error("Configuration string is incomplete.");
      tokens.push({
        value: source.slice(start, i),
        start,
        end: i,
        kind: "string",
      });
    } else {
      const word = /^[A-Za-z_$][\w$]*|^\d+(?:\.\d+)?/u.exec(source.slice(i));
      if (word) {
        i += word[0].length;
        tokens.push({ value: word[0], start, end: i, kind: "word" });
      } else {
        i++;
        tokens.push({ value: char, start, end: i, kind: "symbol" });
      }
    }
    if (tokens.length > 100000)
      throw new Error("Configuration token count exceeds safe editing bounds.");
  }
  return tokens;
};
interface Property {
  readonly key: string;
  readonly from: number;
  readonly to: number;
}
const propertiesFor = (
  tokens: readonly Token[],
  start: number,
): { end: number; properties: readonly Property[] } => {
  if (tokens[start]?.value !== "{")
    throw new Error(
      "One plain configuration object is required for an editable field.",
    );
  const properties: Property[] = [];
  const names = new Set<string>();
  let i = start + 1;
  while (tokens[i]?.value !== "}") {
    const key = tokens[i];
    if (
      !key ||
      key.kind !== "word" ||
      !/^[A-Za-z_$][\w$]*$/u.test(key.value) ||
      tokens[i + 1]?.value !== ":" ||
      names.has(key.value)
    )
      throw new Error(
        "Computed, duplicate, quoted, spread or method configuration keys require manual review.",
      );
    names.add(key.value);
    i += 2;
    const from = i;
    const stack: string[] = [];
    for (; i < tokens.length; i++) {
      const value = tokens[i]!.value;
      if (!stack.length && [",", "}"].includes(value)) break;
      if (["{", "[", "("].includes(value)) stack.push(value);
      if (["}", "]", ")"].includes(value)) {
        const expected = (
          { "}": "{", "]": "[", ")": "(" } as Record<string, string>
        )[value];
        if (stack.pop() !== expected)
          throw new Error("Configuration delimiters are inconsistent.");
      }
    }
    if (i === from || i >= tokens.length || stack.length)
      throw new Error("Configuration value is incomplete.");
    properties.push({ key: key.value, from, to: i });
    if (tokens[i]?.value === ",") i++;
  }
  return { end: i, properties };
};
const literalValue = (
  tokens: readonly Token[],
  from: number,
  to: number,
): boolean => {
  if (to === from + 1)
    return (
      tokens[from]!.kind === "string" ||
      /^(?:true|false|null|\d+(?:\.\d+)?)$/u.test(tokens[from]!.value)
    );
  if (tokens[from]?.value === "[" && tokens[to - 1]?.value === "]") {
    let begin = from + 1;
    let depth = 0;
    for (let i = begin; i < to; i++) {
      const value = tokens[i]!.value;
      if ((!depth && value === ",") || i === to - 1) {
        if (begin < i && !literalValue(tokens, begin, i)) return false;
        begin = i + 1;
      } else if (["[", "{"].includes(value)) depth++;
      else if (["]", "}"].includes(value)) depth--;
    }
    return true;
  }
  if (tokens[from]?.value === "{" && tokens[to - 1]?.value === "}") {
    const object = propertiesFor(tokens, from);
    return (
      object.end === to - 1 &&
      object.properties.every((p) => literalValue(tokens, p.from, p.to))
    );
  }
  return false;
};

/** The editable object must be the complete supported default-export expression. */
const exportedLiteralStart = (
  source: string,
  tokens: readonly Token[],
): number => {
  const exports = tokens.flatMap((token, index) =>
    token.value === "export" && tokens[index + 1]?.value === "default"
      ? [index + 2]
      : [],
  );
  if (exports.length !== 1)
    throw new Error(
      "One exported literal configuration is required; use manual source editing.",
    );
  let start = exports[0]!;
  const wrapped =
    tokens[start]?.value === "defineRehearsalConfig" &&
    tokens[start + 1]?.value === "(";
  if (wrapped) start += 2;
  let end = propertiesFor(tokens, start).end;
  if (wrapped) {
    end += 1;
    // A trailing comma still declares one argument; any additional argument is manual.
    if (tokens[end]?.value === "," && tokens[end + 1]?.value === ")") end += 1;
    if (tokens[end]?.value !== ")")
      throw new Error(
        "The exported configuration wrapper requires one literal argument; use manual source editing.",
      );
  }
  const next = tokens[end + 1];
  if (next && next.value !== ";") {
    const lineBreak = /[\r\n\u2028\u2029]/u.test(
      source.slice(tokens[end]!.end, next.start),
    );
    const declaration =
      ["const", "let", "var", "function", "class", "export", "import"].includes(
        next.value,
      ) ||
      (next.value === "async" && tokens[end + 2]?.value === "function");
    if (!lineBreak || !declaration)
      throw new Error(
        "The exported configuration expression requires manual source editing.",
      );
  }
  return start;
};

const configurationPropertyAtPath = (
  source: string,
  path: string,
):
  | { readonly tokens: readonly Token[]; readonly property: Property }
  | undefined => {
  const tokens = tokensFor(source);
  let start = exportedLiteralStart(source, tokens);
  const keys = path.split(".");
  for (let i = 0; i < keys.length; i++) {
    const object = propertiesFor(tokens, start);
    const property = object.properties.find(
      (property) => property.key === keys[i],
    );
    if (!property) return undefined;
    if (i === keys.length - 1) return { tokens, property };
    if (
      tokens[property.from]?.value !== "{" ||
      propertiesFor(tokens, property.from).end !== property.to - 1
    )
      throw new Error("A configuration owner requires manual source review.");
    start = property.from;
  }
  return undefined;
};

export const hasLiteralConfigurationPath = (
  source: string,
  path: string,
): boolean => configurationPropertyAtPath(source, path) !== undefined;

/** Decode only one already-tokenized string; never evaluate configuration code. */
const stringLiteralValue = (source: string): string => {
  let value = "";
  const end = source.length - 1;
  for (let index = 1; index < end; index++) {
    const character = source[index]!;
    if (character === "\n" || character === "\r")
      throw new Error("A configuration string requires manual source review.");
    if (character !== "\\") {
      value += character;
      continue;
    }
    const escaped = source[++index];
    if (escaped === undefined || index >= end)
      throw new Error("A configuration string escape is incomplete.");
    if (escaped === "\n" || escaped === "\u2028" || escaped === "\u2029")
      continue;
    if (escaped === "\r") {
      if (source[index + 1] === "\n") index++;
      continue;
    }
    const escapes: Readonly<Record<string, string>> = {
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      v: "\v",
    };
    if (Object.hasOwn(escapes, escaped)) {
      value += escapes[escaped]!;
      continue;
    }
    if (escaped === "0" && !/\d/u.test(source[index + 1] ?? "")) {
      value += "\0";
      continue;
    }
    if (escaped === "x" || escaped === "u") {
      const braced = escaped === "u" && source[index + 1] === "{";
      const from = index + (braced ? 2 : 1);
      const to = braced
        ? source.indexOf("}", from)
        : from + (escaped === "x" ? 2 : 4);
      const digits = source.slice(from, to);
      if (
        to < from ||
        to > end ||
        (braced && to >= end) ||
        !(
          braced
            ? /^[a-f0-9]{1,6}$/iu
            : escaped === "x"
              ? /^[a-f0-9]{2}$/iu
              : /^[a-f0-9]{4}$/iu
        ).test(digits)
      )
        throw new Error(
          "A configuration string escape requires manual source review.",
        );
      const codePoint = Number.parseInt(digits, 16);
      if (codePoint > 0x10ffff)
        throw new Error(
          "A configuration string escape requires manual source review.",
        );
      value += String.fromCodePoint(codePoint);
      index = braced ? to : to - 1;
      continue;
    }
    if (/\d/u.test(escaped))
      throw new Error(
        "Legacy numeric string escapes require manual source review.",
      );
    // Quoted characters, backslashes and non-escape characters have their JS literal value.
    value += escaped;
  }
  return value;
};

/** Compare known scalar literals without changing their quoting, comments or whitespace. */
export const matchesLiteralConfigurationValue = (
  source: string,
  path: string,
  expected: string | boolean,
): boolean => {
  const found = configurationPropertyAtPath(source, path);
  if (!found) return false;
  const { tokens, property } = found;
  if (!literalValue(tokens, property.from, property.to))
    throw new Error(
      `The active configuration does not contain one editable ${path} literal.`,
    );
  if (property.to !== property.from + 1) return false;
  const token = tokens[property.from]!;
  if (token.kind === "string")
    return stringLiteralValue(token.value) === expected;
  return token.value === "true"
    ? expected === true
    : token.value === "false"
      ? expected === false
      : false;
};

export const editLiteralConfiguration = (
  source: string,
  changes: readonly { readonly path: string; readonly value: unknown }[],
): string => {
  const literal = (value: unknown, depth = 0): string => {
    if (depth > 5)
      throw new Error("Configuration proposal exceeds safe literal depth.");
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    )
      return JSON.stringify(value);
    if (Array.isArray(value) && value.length <= 32)
      return `[${value.map((item) => literal(item, depth + 1)).join(", ")}]`;
    if (value && typeof value === "object" && Object.keys(value).length <= 32) {
      return `{ ${Object.entries(value)
        .map(([key, item]) => {
          if (!/^[A-Za-z][\w]*$/u.test(key))
            throw new Error(
              "Configuration literal keys require manual review.",
            );
          return `${key}: ${literal(item, depth + 1)}`;
        })
        .join(", ")} }`;
    }
    throw new Error("Only bounded JSON literals may be proposed.");
  };
  let result = source;
  for (const change of changes) {
    const tokens = tokensFor(result);
    let start = exportedLiteralStart(result, tokens);
    const keys = change.path.split(".");
    if (
      !keys.length ||
      keys.some(
        (key) =>
          !/^[A-Za-z][\w]*$/u.test(key) ||
          ["__proto__", "prototype", "constructor"].includes(key),
      )
    )
      throw new Error("Invalid editable configuration path.");
    for (let index = 0; index < keys.length; index++) {
      const object = propertiesFor(tokens, start);
      const property = object.properties.find((p) => p.key === keys[index]);
      if (!property) {
        let value = change.value;
        for (let keyIndex = keys.length - 1; keyIndex > index; keyIndex--)
          value = { [keys[keyIndex]!]: value };
        const insertion = `\n    ${keys[index]}: ${literal(value)},`;
        const location = tokens[start]!.end;
        result = result.slice(0, location) + insertion + result.slice(location);
        break;
      }
      if (index === keys.length - 1) {
        if (!literalValue(tokens, property.from, property.to))
          throw new Error(
            `The active configuration does not contain one editable ${change.path} literal.`,
          );
        const from = tokens[property.from]!.start;
        const to = tokens[property.to - 1]!.end;
        result =
          result.slice(0, from) + literal(change.value) + result.slice(to);
      } else {
        if (
          tokens[property.from]?.value !== "{" ||
          propertiesFor(tokens, property.from).end !== property.to - 1
        )
          throw new Error(
            `The ${keys[index]} configuration owner requires manual source review.`,
          );
        start = property.from;
      }
    }
  }
  return result;
};
