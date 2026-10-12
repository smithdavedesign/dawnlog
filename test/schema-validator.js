// A small JSON Schema (2020-12) validator for the keywords schema/receipts.schema.json uses, so
// the --json test needs no dependency: type, const, enum, required, properties,
// additionalProperties: false, items, anyOf, $ref (#/$defs/…), pattern, minimum, format: date-time.
// An unknown keyword throws, so the schema can't quietly grow past what's checked.
const KNOWN = new Set(['$schema', '$id', 'title', 'description', '$defs', 'type', 'const', 'enum', 'required', 'properties', 'additionalProperties', 'items', 'anyOf', '$ref', 'pattern', 'minimum', 'format']);

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

const matchesType = (value, type) => typeOf(value) === type || (type === 'number' && typeof value === 'number');

/** @returns {string[]} errors, empty when valid */
export function validate(schema, value, root = schema, at = '$') {
  for (const key of Object.keys(schema)) if (!KNOWN.has(key)) throw new Error(`validator: unsupported keyword "${key}" at ${at}`);
  if (schema.$ref) {
    const name = /^#\/\$defs\/(.+)$/.exec(schema.$ref)?.[1];
    if (!name || !root.$defs?.[name]) throw new Error(`validator: bad $ref ${schema.$ref}`);
    return validate(root.$defs[name], value, root, at);
  }
  const errors = [];
  if (schema.anyOf) {
    const branches = schema.anyOf.map((s) => validate(s, value, root, at));
    if (!branches.some((e) => e.length === 0)) errors.push(`${at}: matches no anyOf branch (${branches.map((e) => e[0]).join(' | ')})`);
    return errors;
  }
  if (schema.type) {
    const types = [].concat(schema.type);
    if (!types.some((t) => matchesType(value, t))) return [`${at}: expected ${types.join('|')}, got ${typeOf(value)}`];
  }
  if ('const' in schema && value !== schema.const) errors.push(`${at}: expected ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: ${JSON.stringify(value)} not in ${JSON.stringify(schema.enum)}`);
  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) errors.push(`${at}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
    if (schema.format === 'date-time' && (!/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(Date.parse(value)))) errors.push(`${at}: not a date-time`);
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) errors.push(`${at}: below ${schema.minimum}`);
  if (Array.isArray(value) && schema.items) value.forEach((item, i) => errors.push(...validate(schema.items, item, root, `${at}[${i}]`)));
  if (typeOf(value) === 'object') {
    for (const key of schema.required ?? []) if (!(key in value)) errors.push(`${at}: missing ${key}`);
    for (const [key, child] of Object.entries(value)) {
      if (schema.properties?.[key]) errors.push(...validate(schema.properties[key], child, root, `${at}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${at}: unexpected property ${key}`);
    }
  }
  return errors;
}
