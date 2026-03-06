import type {
  Graph,
  GraphNode,
  GraphEdge,
  GraphAttributes,
  NodeAttributes,
  EdgeAttributes,
} from "./types.js";

/**
 * Parser for a strict subset of Graphviz DOT syntax.
 *
 * Supports:
 * - digraph Name { ... }
 * - Node declarations: node_id [attr=value, ...]
 * - Edge declarations: A -> B [attr=value, ...] (including chains A -> B -> C)
 * - Graph/node/edge defaults: graph [...], node [...], edge [...]
 * - Subgraphs: subgraph name { ... } (flattened)
 * - Comments: // and /* ... * /
 *
 * Prohibited:
 * - Undirected edges (--)
 * - HTML labels
 * - Multiple graphs per file
 * - strict modifier
 */

interface Token {
  type:
    | "keyword"
    | "identifier"
    | "string"
    | "number"
    | "lbrace"
    | "rbrace"
    | "lbracket"
    | "rbracket"
    | "arrow"
    | "equals"
    | "comma"
    | "semicolon"
    | "eof";
  value: string;
  line: number;
}

function tokenize(input: string): Token[] {
  // Strip comments
  let src = input
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  const tokens: Token[] = [];
  let i = 0;
  let line = 1;

  while (i < src.length) {
    // Whitespace
    if (/\s/.test(src[i])) {
      if (src[i] === "\n") line++;
      i++;
      continue;
    }

    // Symbols
    if (src[i] === "{") {
      tokens.push({ type: "lbrace", value: "{", line });
      i++;
      continue;
    }
    if (src[i] === "}") {
      tokens.push({ type: "rbrace", value: "}", line });
      i++;
      continue;
    }
    if (src[i] === "[") {
      tokens.push({ type: "lbracket", value: "[", line });
      i++;
      continue;
    }
    if (src[i] === "]") {
      tokens.push({ type: "rbracket", value: "]", line });
      i++;
      continue;
    }
    if (src[i] === "=") {
      tokens.push({ type: "equals", value: "=", line });
      i++;
      continue;
    }
    if (src[i] === ",") {
      tokens.push({ type: "comma", value: ",", line });
      i++;
      continue;
    }
    if (src[i] === ";") {
      tokens.push({ type: "semicolon", value: ";", line });
      i++;
      continue;
    }

    // Arrow
    if (src[i] === "-" && src[i + 1] === ">") {
      tokens.push({ type: "arrow", value: "->", line });
      i += 2;
      continue;
    }

    // Undirected edge (prohibited)
    if (src[i] === "-" && src[i + 1] === "-") {
      throw new Error(`Parse error at line ${line}: undirected edges (--) are not supported`);
    }

    // Quoted string
    if (src[i] === '"') {
      let str = "";
      i++; // skip opening quote
      while (i < src.length && src[i] !== '"') {
        if (src[i] === "\\") {
          i++;
          if (src[i] === "n") str += "\n";
          else if (src[i] === "t") str += "\t";
          else if (src[i] === '"') str += '"';
          else if (src[i] === "\\") str += "\\";
          else str += src[i];
        } else {
          if (src[i] === "\n") line++;
          str += src[i];
        }
        i++;
      }
      if (i >= src.length) throw new Error(`Parse error at line ${line}: unterminated string`);
      i++; // skip closing quote
      tokens.push({ type: "string", value: str, line });
      continue;
    }

    // Number
    if (/[0-9]/.test(src[i]) || (src[i] === "-" && /[0-9]/.test(src[i + 1]))) {
      let num = src[i];
      i++;
      while (i < src.length && /[0-9.]/.test(src[i])) {
        num += src[i];
        i++;
      }
      tokens.push({ type: "number", value: num, line });
      continue;
    }

    // Identifier or keyword
    if (/[a-zA-Z_]/.test(src[i])) {
      let id = "";
      while (i < src.length && /[a-zA-Z0-9_.]/.test(src[i])) {
        id += src[i];
        i++;
      }
      const keywords = [
        "digraph",
        "graph",
        "node",
        "edge",
        "subgraph",
        "strict",
      ];
      if (id === "strict") {
        throw new Error(`Parse error at line ${line}: 'strict' modifier is not supported`);
      }
      if (keywords.includes(id)) {
        tokens.push({ type: "keyword", value: id, line });
      } else {
        tokens.push({ type: "identifier", value: id, line });
      }
      continue;
    }

    throw new Error(`Parse error at line ${line}: unexpected character '${src[i]}'`);
  }

  tokens.push({ type: "eof", value: "", line });
  return tokens;
}

class Parser {
  private tokens: Token[];
  private pos = 0;
  private graph: Graph;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.graph = {
      name: "",
      nodes: new Map(),
      edges: [],
      attributes: {},
      node_defaults: {},
      edge_defaults: {},
    };
  }

  parse(): Graph {
    this.expect("keyword", "digraph");
    this.graph.name = this.consumeIdentOrString();
    this.expect("lbrace");
    this.parseBody();
    this.expect("rbrace");
    return this.graph;
  }

  private parseBody(): void {
    while (this.peek().type !== "rbrace" && this.peek().type !== "eof") {
      this.parseStatement();
      // Optional semicolon
      if (this.peek().type === "semicolon") this.advance();
    }
  }

  private parseStatement(): void {
    const tok = this.peek();

    // subgraph
    if (tok.type === "keyword" && tok.value === "subgraph") {
      this.parseSubgraph();
      return;
    }

    // graph/node/edge defaults
    if (tok.type === "keyword" && tok.value === "graph") {
      this.advance();
      if (this.peek().type === "lbracket") {
        const attrs = this.parseAttributeList();
        Object.assign(this.graph.attributes, attrs);
      }
      return;
    }

    if (tok.type === "keyword" && tok.value === "node") {
      this.advance();
      if (this.peek().type === "lbracket") {
        const attrs = this.parseAttributeList();
        Object.assign(this.graph.node_defaults, attrs);
      }
      return;
    }

    if (tok.type === "keyword" && tok.value === "edge") {
      this.advance();
      if (this.peek().type === "lbracket") {
        const attrs = this.parseAttributeList();
        Object.assign(this.graph.edge_defaults, attrs);
      }
      return;
    }

    // Node or edge
    if (tok.type === "identifier" || tok.type === "string") {
      const id = this.consumeIdentOrString();

      // Check if this is an edge
      if (this.peek().type === "arrow") {
        const chain = [id];
        while (this.peek().type === "arrow") {
          this.advance(); // consume ->
          chain.push(this.consumeIdentOrString());
        }

        const edgeAttrs =
          this.peek().type === "lbracket" ? this.parseAttributeList() : {};

        // Ensure all nodes in chain exist
        for (const nodeId of chain) {
          if (!this.graph.nodes.has(nodeId)) {
            this.graph.nodes.set(nodeId, {
              id: nodeId,
              attributes: { ...this.graph.node_defaults },
            });
          }
        }

        // Create edges for each pair
        for (let i = 0; i < chain.length - 1; i++) {
          this.graph.edges.push({
            source: chain[i],
            target: chain[i + 1],
            attributes: { ...this.graph.edge_defaults, ...edgeAttrs },
          });
        }
        return;
      }

      // Node declaration
      const nodeAttrs: NodeAttributes =
        this.peek().type === "lbracket"
          ? this.parseAttributeList()
          : {};

      const existing = this.graph.nodes.get(id);
      if (existing) {
        Object.assign(existing.attributes, nodeAttrs);
      } else {
        this.graph.nodes.set(id, {
          id,
          attributes: { ...this.graph.node_defaults, ...nodeAttrs },
        });
      }
      return;
    }

    throw new Error(
      `Parse error at line ${tok.line}: unexpected token '${tok.value}'`
    );
  }

  private parseSubgraph(): void {
    this.expect("keyword", "subgraph");
    // Optional name
    if (this.peek().type === "identifier" || this.peek().type === "string") {
      this.advance();
    }
    this.expect("lbrace");
    this.parseBody();
    this.expect("rbrace");
  }

  private parseAttributeList(): Record<string, unknown> {
    const attrs: Record<string, unknown> = {};
    this.expect("lbracket");

    while (this.peek().type !== "rbracket" && this.peek().type !== "eof") {
      const key = this.consumeIdentOrString();
      this.expect("equals");
      const value = this.consumeValue();
      attrs[key] = value;

      if (this.peek().type === "comma" || this.peek().type === "semicolon") {
        this.advance();
      }
    }

    this.expect("rbracket");
    return attrs;
  }

  private consumeValue(): unknown {
    const tok = this.peek();

    if (tok.type === "string") {
      this.advance();
      return tok.value;
    }

    if (tok.type === "number") {
      this.advance();
      return tok.value.includes(".")
        ? parseFloat(tok.value)
        : parseInt(tok.value, 10);
    }

    if (tok.type === "identifier") {
      this.advance();
      if (tok.value === "true") return true;
      if (tok.value === "false") return false;
      return tok.value;
    }

    throw new Error(
      `Parse error at line ${tok.line}: expected value but got '${tok.value}'`
    );
  }

  private consumeIdentOrString(): string {
    const tok = this.peek();
    if (tok.type === "identifier" || tok.type === "string") {
      this.advance();
      return tok.value;
    }
    throw new Error(
      `Parse error at line ${tok.line}: expected identifier or string but got '${tok.type}'`
    );
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    return this.tokens[this.pos++];
  }

  private expect(type: string, value?: string): Token {
    const tok = this.advance();
    if (tok.type !== type || (value !== undefined && tok.value !== value)) {
      throw new Error(
        `Parse error at line ${tok.line}: expected ${type}${value ? ` '${value}'` : ""} but got ${tok.type} '${tok.value}'`
      );
    }
    return tok;
  }
}

export function parseDOT(input: string): Graph {
  const tokens = tokenize(input);
  const parser = new Parser(tokens);
  return parser.parse();
}
