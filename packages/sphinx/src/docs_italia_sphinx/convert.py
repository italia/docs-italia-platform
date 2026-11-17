"""Doctree di docutils/Sphinx -> AST MyST (mdast con le estensioni di Docs Italia).

Si converte il doctree NON risolto (env.get_doctree): i riferimenti restano
etichette ({ref}`…`) invece di diventare URL, così l'AST si può riscrivere in
MyST con il serializzatore a blocchi del toolkit.

I nodi che non si sanno convertire finiscono nel rapporto (Report): il testo
viene conservato come paragrafo, e il rapporto dice dove.
"""

from __future__ import annotations

import posixpath
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

from docutils import nodes
from docutils.nodes import fully_normalize_name
from sphinx import addnodes

Node = dict[str, Any]

ADMONITIONS = {
    nodes.note: "note",
    nodes.tip: "tip",
    nodes.hint: "hint",
    nodes.important: "important",
    nodes.attention: "attention",
    nodes.caution: "caution",
    nodes.warning: "warning",
    nodes.danger: "danger",
    nodes.error: "error",
}

SKIP = (
    nodes.comment,
    nodes.substitution_definition,
    nodes.system_message,
    addnodes.index,
    nodes.meta if hasattr(nodes, "meta") else nodes.comment,
)


class forum_node(nodes.General, nodes.Element):
    """Nodo della direttiva RST forum_italia."""


@dataclass
class Report:
    unsupported: Counter = field(default_factory=Counter)
    dropped: Counter = field(default_factory=Counter)
    where: list[str] = field(default_factory=list)
    assets: set[str] = field(default_factory=set)

    def note(self, kind: str, docname: str, node: nodes.Node, counter: str = "unsupported") -> None:
        getattr(self, counter)[kind] += 1
        line = getattr(node, "line", None)
        self.where.append(f"{docname}{':' + str(line) if line else ''}: {counter} {kind}")


def text(value: str) -> Node:
    return {"type": "text", "value": value}


class Converter:
    def __init__(self, env: Any, docname: str, report: Report):
        self.env = env
        self.docname = docname
        self.report = report
        self.dir = posixpath.dirname(docname)

    # ------------------------------------------------------------------ utilità

    def rel(self, srcpath: str) -> str:
        """Percorso relativo alla pagina corrente di un file indicato dalla radice della sorgente."""
        return posixpath.relpath(srcpath, self.dir or ".")

    def inline_children(self, node: nodes.Node) -> list[Node]:
        out: list[Node] = []
        for c in node.children:
            out.extend(self.inline(c))
        return out

    def block_children(self, node: nodes.Node, depth: int) -> list[Node]:
        out: list[Node] = []
        for c in node.children:
            out.extend(self.block(c, depth))
        return out

    def paragraphs(self, node: nodes.Node, depth: int) -> list[Node]:
        """Figli di un nodo che può contenere sia testo sia blocchi (voci di elenco, celle)."""
        blocks = self.block_children(node, depth)
        return blocks

    # ------------------------------------------------------------------ blocchi

    def document(self, doctree: nodes.document) -> list[Node]:
        return self.block_children(doctree, 0)

    def block(self, n: nodes.Node, depth: int) -> list[Node]:
        if isinstance(n, SKIP):
            return []
        if isinstance(n, nodes.section):
            return self.section(n, depth + 1)
        if isinstance(n, nodes.paragraph):
            return [{"type": "paragraph", "children": self.inline_children(n)}]
        if isinstance(n, (nodes.bullet_list, nodes.enumerated_list)):
            ordered = isinstance(n, nodes.enumerated_list)
            items = [{"type": "listItem", "children": self.paragraphs(li, depth)} for li in n.children if isinstance(li, nodes.list_item)]
            out: Node = {"type": "list", "ordered": ordered, "spread": False, "children": items}
            if ordered:
                out["start"] = n.get("start", 1)
            return [out]
        if isinstance(n, nodes.definition_list):
            children: list[Node] = []
            for item in n.children:
                for part in item.children:
                    if isinstance(part, nodes.term):
                        children.append({"type": "definitionTerm", "children": self.inline_children(part)})
                    elif isinstance(part, nodes.definition):
                        children.append({"type": "definitionDescription", "children": self.paragraphs(part, depth)})
            return [{"type": "definitionList", "children": children}]
        if isinstance(n, nodes.literal_block):
            lang = n.get("language")
            out = {"type": "code", "value": n.astext()}
            if lang and lang not in ("default", "none", "text"):
                out["lang"] = lang
            return [out]
        if isinstance(n, nodes.block_quote):
            kids = self.block_children(n, depth)
            return [{"type": "blockquote", "children": kids}]
        if isinstance(n, nodes.attribution):
            return [{"type": "paragraph", "children": [text("— "), *self.inline_children(n)]}]
        if type(n) in ADMONITIONS:
            return [{"type": "admonition", "kind": ADMONITIONS[type(n)], "children": self.block_children(n, depth)}]
        if isinstance(n, (nodes.admonition, nodes.topic, nodes.sidebar)):
            return [self.titled_box(n, depth)]
        if isinstance(n, nodes.figure):
            return [self.figure(n, depth)]
        if isinstance(n, nodes.image):
            return [self.image(n, block=True)]
        if isinstance(n, nodes.table):
            return [self.table(n, depth)]
        if isinstance(n, nodes.footnote):
            label = n.next_node(nodes.label)
            ident = label.astext() if label else (n["names"][0] if n["names"] else n["ids"][0])
            kids = [c for c in n.children if not isinstance(c, nodes.label)]
            out = {"type": "footnoteDefinition", "identifier": ident, "label": ident, "children": []}
            for c in kids:
                out["children"].extend(self.block(c, depth))
            return [out]
        if isinstance(n, nodes.transition):
            return [{"type": "thematicBreak"}]
        if isinstance(n, nodes.rubric):
            return [{"type": "paragraph", "children": [{"type": "strong", "children": self.inline_children(n)}]}]
        if isinstance(n, nodes.line_block):
            kids: list[Node] = []
            for i, line in enumerate(n.traverse(nodes.line)):
                if i:
                    kids.append({"type": "break"})
                kids.extend(self.inline_children(line))
            return [{"type": "paragraph", "children": kids}]
        if isinstance(n, nodes.compound):
            if any(isinstance(c, addnodes.toctree) for c in n.children):
                return []  # l'indice va in toc.json
            return self.block_children(n, depth)
        if isinstance(n, addnodes.toctree):
            return []
        if isinstance(n, nodes.target):
            return []  # etichette: gestite sulle sezioni; link con nome: già risolti
        if isinstance(n, addnodes.only):
            expr = n.get("expr", "")
            if "html" in expr:
                return self.block_children(n, depth)
            self.report.note(f"only:: {expr}", self.docname, n, "dropped")
            return []
        if isinstance(n, nodes.raw):
            if "html" in n.get("format", ""):
                return [{"type": "html", "value": n.astext()}]
            self.report.note(f"raw:: {n.get('format')}", self.docname, n, "dropped")
            return []
        if isinstance(n, forum_node):
            opts = {k: n[k] for k in ("topic_id", "scope") if n.get(k) is not None}
            return [{"type": "forum", "topicId": n.get("topic_id"), "scope": n.get("scope"),
                     "origin": {"kind": "directive", "name": "forum_italia", "options": opts, "value": ""}}]
        if isinstance(n, nodes.container):
            return self.block_children(n, depth)
        # sconosciuto: si conserva il testo
        self.report.note(type(n).__name__, self.docname, n)
        content = n.astext().strip()
        return [{"type": "paragraph", "children": [text(content)]}] if content else []

    def section(self, n: nodes.section, depth: int) -> list[Node]:
        title = n.next_node(nodes.title)
        title_text = title.astext() if title else ""
        out: list[Node] = []
        auto = fully_normalize_name(title_text)
        for name in n.get("names", []):
            if name != auto:
                out.append({"type": "mystTarget", "label": name})
        out.append({"type": "heading", "depth": min(depth, 6), "children": self.inline_children(title) if title else []})
        for c in n.children:
            if c is title:
                continue
            out.extend(self.block(c, depth))
        return out

    def titled_box(self, n: nodes.Element, depth: int) -> Node:
        title = n.next_node(nodes.title)
        classes = [c for c in n.get("classes", []) if not c.startswith("admonition-")]
        if isinstance(n, nodes.topic):
            classes = ["topic", *classes]
        body: list[Node] = []
        for c in n.children:
            if c is title:
                continue
            body.extend(self.block(c, depth))
        out: Node = {"type": "admonition", "children": ([{"type": "admonitionTitle", "children": self.inline_children(title)}] if title else []) + body}
        if classes:
            out["class"] = " ".join(classes)
        return out

    def image(self, n: nodes.image, block: bool) -> Node:
        uri = n.get("uri", "")
        url = uri if "://" in uri else self.rel(uri)
        if "://" not in uri:
            self.report.assets.add(uri)
        out: Node = {"type": "image", "url": url, "alt": n.get("alt", "")}
        for k in ("align", "width", "height"):
            if n.get(k):
                out[k] = n[k]
        if block:
            out["origin"] = {"kind": "directive", "name": "image", "args": url, "options": {}, "value": ""}
        return out

    def figure(self, n: nodes.figure, depth: int) -> Node:
        kids: list[Node] = []
        img = n.next_node(nodes.image)
        if img is not None:
            image = self.image(img, block=False)
            if n.get("align"):
                image["align"] = n["align"]
            kids.append(image)
        cap = n.next_node(nodes.caption)
        if cap is not None:
            kids.append({"type": "caption", "children": [{"type": "paragraph", "children": self.inline_children(cap)}]})
        leg = n.next_node(nodes.legend)
        if leg is not None:
            kids.append({"type": "legend", "children": self.block_children(leg, depth)})
        out: Node = {"type": "container", "kind": "figure", "children": kids}
        explicit = [x for x in n.get("names", [])]
        if explicit:
            out["label"] = explicit[0]
        return out

    def table(self, n: nodes.table, depth: int) -> Node:
        title = n.next_node(nodes.title)
        rows: list[Node] = []
        spans = False
        for part in n.traverse(lambda x: isinstance(x, (nodes.thead, nodes.tbody))):
            header = isinstance(part, nodes.thead)
            for row in part.children:
                cells = []
                for entry in row.children:
                    if entry.get("morecols") or entry.get("morerows"):
                        spans = True
                    cell: Node = {"type": "tableCell", "children": self.paragraphs(entry, depth)}
                    if header:
                        cell["header"] = True
                    cells.append(cell)
                rows.append({"type": "tableRow", "children": cells})
        if spans:
            self.report.note("tabella con celle unite (unione persa)", self.docname, n, "dropped")
        kids: list[Node] = []
        if title is not None:
            kids.append({"type": "caption", "children": [{"type": "paragraph", "children": self.inline_children(title)}]})
        kids.append({"type": "table", "children": rows})
        out: Node = {"type": "container", "kind": "table", "children": kids}
        if n.get("names"):
            out["label"] = n["names"][0]
        return out

    # ------------------------------------------------------------------ in linea

    def inline(self, n: nodes.Node) -> list[Node]:
        if isinstance(n, nodes.Text):
            return [text(n.astext())]
        if isinstance(n, SKIP) or isinstance(n, nodes.target):
            return []
        if isinstance(n, nodes.emphasis) or isinstance(n, nodes.title_reference):
            return [{"type": "emphasis", "children": self.inline_children(n)}]
        if isinstance(n, nodes.strong):
            return [{"type": "strong", "children": self.inline_children(n)}]
        if isinstance(n, nodes.literal):
            return [{"type": "inlineCode", "value": n.astext()}]
        if isinstance(n, nodes.subscript):
            return [{"type": "subscript", "children": self.inline_children(n)}]
        if isinstance(n, nodes.superscript):
            return [{"type": "superscript", "children": self.inline_children(n)}]
        if isinstance(n, nodes.abbreviation):
            return self.inline_children(n)
        if isinstance(n, nodes.footnote_reference):
            ident = n.astext()
            return [{"type": "footnoteReference", "identifier": ident, "label": ident}]
        # download_reference è una sottoclasse di reference: va controllato prima
        if isinstance(n, addnodes.download_reference):
            return [self.download(n)]
        if isinstance(n, nodes.reference):
            if n.get("refuri"):
                return [{"type": "link", "url": n["refuri"], "children": self.inline_children(n)}]
            if n.get("refid"):
                return [{"type": "link", "url": "#" + n["refid"], "children": self.inline_children(n)}]
            return self.inline_children(n)
        if isinstance(n, addnodes.pending_xref):
            return [self.xref(n)]
        if isinstance(n, nodes.image):
            return [self.image(n, block=False)]
        if isinstance(n, (nodes.inline, nodes.generated, nodes.problematic)):
            return self.inline_children(n)
        self.report.note(f"in linea: {type(n).__name__}", self.docname, n)
        return [text(n.astext())]

    def xref(self, n: addnodes.pending_xref) -> Node:
        typ = n.get("reftype")
        target = n.get("reftarget", "")
        explicit = n.get("refexplicit")
        label = n.astext()
        if typ == "doc":
            path = target if target.startswith("/") else posixpath.normpath(posixpath.join(self.dir, target))
            path = path.lstrip("/")
            title = self.env.titles.get(path)
            kids = [text(label if explicit else (title.astext() if title else label))]
            return {"type": "link", "url": self.rel(path) + ".md", "children": kids}
        if typ in ("ref", "numref", "term"):
            value = f"{label} <{target}>" if explicit else target
            return {"type": "crossReference", "kind": typ, "identifier": target, "label": target,
                    "children": [text(label)] if explicit else [],
                    "origin": {"kind": "role", "name": typ, "value": value}}
        self.report.note(f"riferimento {n.get('refdomain')}:{typ}", self.docname, n)
        return text(label)

    def download(self, n: nodes.Node) -> Node:
        target = n.get("reftarget", "")
        src = target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join(self.dir, target))
        self.report.assets.add(src)
        return {"type": "link", "url": self.rel(src), "children": [text(n.astext())]}
