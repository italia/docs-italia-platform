"""Doctree di docutils/Sphinx -> AST MyST (mdast con le estensioni di Docs Italia).

Si converte il doctree NON risolto (env.get_doctree): i riferimenti restano
etichette ({ref}`…`) invece di diventare URL, così l'AST si può riscrivere in
MyST con il serializzatore a blocchi del toolkit.

I nodi che non si sanno convertire finiscono nel rapporto (Report): il testo
viene conservato come paragrafo, e il rapporto dice dove.
"""

from __future__ import annotations

import posixpath
import re
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
    addnodes.index,
    nodes.meta if hasattr(nodes, "meta") else nodes.comment,
)


class forum_node(nodes.General, nodes.Element):
    """Nodo della direttiva RST forum_italia."""


SAFE_SCHEMES = ("http://", "https://", "mailto:", "tel:")

# testo di un commento che in realtà voleva essere una direttiva: "code-block::java"
LOOKS_LIKE_DIRECTIVE = re.compile(r"^[A-Za-z][\w-]*::\S")


def safe_label(name: str) -> str:
    """Etichetta valida per MyST: `(§4.4)=` non è un'etichetta, `(sez-4.4)=` sì."""
    import re

    out = re.sub(r"[^A-Za-z0-9_.:-]+", "-", name.strip()).strip("-")
    return out or "etichetta"


@dataclass
class Labels:
    """Etichette da emettere: per pagina, id docutils dell'elemento -> etichette MyST."""

    needed: dict[str, dict[str, list[str]]] = field(default_factory=dict)
    emitted: set[str] = field(default_factory=set)

    def add(self, docname: str, node_id: str, label: str) -> None:
        lst = self.needed.setdefault(docname, {}).setdefault(node_id, [])
        if label not in lst:
            lst.append(label)


@dataclass
class Report:
    unsupported: Counter = field(default_factory=Counter)
    dropped: Counter = field(default_factory=Counter)
    where: list[str] = field(default_factory=list)
    # file del documento: percorso nel progetto MyST → percorso nella sorgente RST
    assets: dict[str, str] = field(default_factory=dict)

    def asset(self, src: str) -> str:
        """Registra un file e restituisce dove starà nel progetto MyST.

        Sphinx accetta immagini e download fuori dalla cartella della sorgente
        (`../../media/x.png` da docs/it): nel progetto MyST finiscono in
        `esterni/`, perché il progetto deve contenere tutti i suoi file.
        """
        src = posixpath.normpath(src)
        dest = src
        if src == ".." or src.startswith("../"):
            dest = "esterni/" + re.sub(r"^(\.\./)+", "", src)
        self.assets[dest] = src
        return dest

    def note(self, kind: str, docname: str, node: nodes.Node, counter: str = "unsupported") -> None:
        getattr(self, counter)[kind] += 1
        line = getattr(node, "line", None)
        self.where.append(f"{docname}{':' + str(line) if line else ''}: {counter} {kind}")


def text(value: str) -> Node:
    return {"type": "text", "value": value}


def parse_rst_directive(source: str) -> dict[str, Any] | None:
    """Scompone il testo di una direttiva RST (`.. nome:: argomenti`, opzioni, corpo)."""
    lines = source.split("\n")
    import re

    m = re.match(r"^\.\.\s+([\w:.-]+)::\s*(.*)$", lines[0].strip())
    if not m:
        return None
    name, args = m.group(1), m.group(2).strip()
    options: dict[str, Any] = {}
    i = 1
    while i < len(lines):
        om = re.match(r"^\s+:([\w-]+):\s*(.*)$", lines[i])
        if not om:
            break
        options[om.group(1)] = om.group(2).strip() or True
        i += 1
    body = [l for l in lines[i:]]
    indent = min((len(l) - len(l.lstrip()) for l in body if l.strip()), default=0)
    value = "\n".join(l[indent:] for l in body).strip("\n")
    return {"name": name, "args": args or None, "options": options, "value": value}


class Converter:
    def __init__(self, env: Any, docname: str, report: Report, labels: Labels | None = None):
        self.env = env
        self.docname = docname
        self.report = report
        self.labels = labels or Labels()
        self.dir = posixpath.dirname(docname)

    def targets_for(self, n: nodes.Node) -> list[Node]:
        """Etichette MyST da mettere prima di un elemento: nomi espliciti e etichette richieste dai riferimenti."""
        if not isinstance(n, nodes.Element) or isinstance(n, (nodes.footnote, nodes.citation)):
            return []
        names: list[str] = []
        if not isinstance(n, nodes.section):
            names += [safe_label(x) for x in n.get("names", []) if not isinstance(n, (nodes.figure, nodes.table))]
        need = self.labels.needed.get(self.docname, {})
        for i in n.get("ids", []):
            names += need.get(i, [])
        out: list[Node] = []
        for name in names:
            key = name.lower()
            if key in self.labels.emitted:
                if name not in [x["label"] for x in out]:
                    self.report.note(f"etichetta ripetuta: {name}", self.docname, n, "dropped")
                continue
            self.labels.emitted.add(key)
            out.append({"type": "mystTarget", "label": name})
        return out

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
        if isinstance(n, nodes.comment) and LOOKS_LIKE_DIRECTIVE.match(n.astext()):
            # ".. code-block::java" senza spazio dopo "::": per RST è un commento e
            # non si pubblica, né oggi su docs.italia.it né qui. Lo si segnala.
            self.report.note("commento che sembra una direttiva (manca lo spazio dopo «::»)", self.docname, n, "dropped")
            return []
        if isinstance(n, SKIP):
            return []
        if isinstance(n, nodes.system_message):
            return self.system_message(n)
        if isinstance(n, nodes.section):
            return self.section(n, depth + 1)
        out = self.block_inner(n, depth)
        if out and not isinstance(n, (nodes.target, addnodes.toctree)):
            return self.targets_for(n) + out
        return out

    def block_inner(self, n: nodes.Node, depth: int) -> list[Node]:
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
        if isinstance(n, addnodes.seealso):
            return [{"type": "admonition", "kind": "seealso", "children": self.block_children(n, depth)}]
        if isinstance(n, addnodes.glossary):
            return [self.glossary(n, depth)]
        if isinstance(n, nodes.container) and "literal-block-wrapper" in n.get("classes", []):
            return self.captioned_code(n)
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
        if isinstance(n, nodes.field_list):
            # ":Fonte: Istat": Sphinx lo rende come elenco di definizioni (dl.field-list)
            children = []
            for f in n.children:
                name = f.next_node(nodes.field_name)
                body = f.next_node(nodes.field_body)
                if name is None:
                    continue
                children.append({"type": "definitionTerm", "children": self.inline_children(name)})
                children.append({"type": "definitionDescription", "children": self.paragraphs(body, depth) if body is not None else []})
            return [{"type": "definitionList", "children": children}]
        if isinstance(n, addnodes.desc):
            # descrizione di un oggetto di un dominio Sphinx (".. class:: dcatapit:Dataset",
            # ".. function:: …"): la firma in grassetto come codice, poi il contenuto
            out = []
            for sig in n.children:
                if isinstance(sig, addnodes.desc_signature):
                    out.append({"type": "paragraph", "children": [{"type": "strong", "children": [{"type": "inlineCode", "value": sig.astext().strip()}]}]})
            content = n.next_node(addnodes.desc_content)
            if content is not None:
                out.extend(self.block_children(content, depth))
            return out
        if isinstance(n, nodes.container):
            return self.block_children(n, depth)
        # sconosciuto: si conserva il testo
        self.report.note(type(n).__name__, self.docname, n)
        content = n.astext().strip()
        return [{"type": "paragraph", "children": [text(content)]}] if content else []

    def system_message(self, n: nodes.system_message) -> list[Node]:
        """Direttiva sconosciuta (es. mermaid, plantuml senza le estensioni del conf.py):
        docutils la sostituisce con un errore che contiene il testo originale. La si
        ricostruisce come direttiva MyST, così il contenuto non si perde e il controllo
        la segnala come non supportata."""
        block = n.next_node(nodes.literal_block)
        if n.get("level", 0) >= 3 and block is not None:
            parsed = parse_rst_directive(block.astext())
            if parsed:
                self.report.note(f"direttiva sconosciuta: {parsed['name']}", self.docname, n)
                return [{"type": "unsupported", "name": parsed["name"], "value": parsed["value"],
                         "origin": {"kind": "directive", **parsed}}]
        if n.get("level", 0) >= 3:
            self.report.note(f"errore di docutils: {n.astext()[:80]}", self.docname, n, "dropped")
        return []

    def section(self, n: nodes.section, depth: int) -> list[Node]:
        title = n.next_node(nodes.title)
        title_text = title.astext() if title else ""
        auto = fully_normalize_name(title_text)
        explicit = [safe_label(x) for x in n.get("names", []) if x != auto]
        out: list[Node] = []
        for name in explicit + [l for i in n.get("ids", []) for l in self.labels.needed.get(self.docname, {}).get(i, [])]:
            if name.lower() in self.labels.emitted:
                continue
            self.labels.emitted.add(name.lower())
            out.append({"type": "mystTarget", "label": name})
        out.append({"type": "heading", "depth": min(depth, 6), "children": self.inline_children(title) if title else []})
        for c in n.children:
            if c is title:
                continue
            out.extend(self.block(c, depth))
        return out

    def glossary(self, n: nodes.Element, depth: int = 0) -> Node:
        """Glossario: direttiva MyST {glossary} con un elenco di definizioni.
        I termini diventano etichette "term-…", che i ruoli {term} raggiungono."""
        children: list[Node] = []
        for item in n.traverse(nodes.definition_list_item):
            for t in item.traverse(nodes.term):
                children.append({"type": "definitionTerm", "children": self.inline_children(t)})
            for d in item.traverse(nodes.definition):
                children.append({"type": "definitionDescription", "children": self.paragraphs(d, depth)})
        return {"type": "glossary", "children": [{"type": "definitionList", "children": children}],
                "origin": {"kind": "directive", "name": "glossary", "options": {}}}

    def captioned_code(self, n: nodes.Element) -> list[Node]:
        cap = n.next_node(nodes.caption)
        code = n.next_node(nodes.literal_block)
        if code is None:
            return []
        lang = code.get("language")
        lang = lang if lang and lang not in ("default", "none", "text") else None
        options: dict[str, Any] = {}
        if cap is not None:
            options["caption"] = cap.astext()
        return [{"type": "code", "value": code.astext(), **({"lang": lang} if lang else {}),
                 "origin": {"kind": "directive", "name": "code-block", "args": lang, "options": options, "value": code.astext()}}]

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
        url = uri if "://" in uri else self.rel(self.report.asset(uri))
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
                return [self.uri_link(n)]
            if n.get("refid"):
                return [{"type": "link", "url": "#" + n["refid"], "children": self.inline_children(n)}]
            return self.inline_children(n)
        if isinstance(n, addnodes.pending_xref):
            return [self.xref(n)]
        if isinstance(n, nodes.image):
            return [self.image(n, block=False)]
        if isinstance(n, nodes.raw):
            import re

            if re.fullmatch(r"\s*<br\s*/?>\s*", n.astext(), re.I):
                return [{"type": "break"}]
            self.report.note("in linea: raw", self.docname, n, "dropped")
            return [{"type": "html", "value": n.astext()}]
        if isinstance(n, (nodes.inline, nodes.generated, nodes.problematic)):
            return self.inline_children(n)
        self.report.note(f"in linea: {type(n).__name__}", self.docname, n)
        return [text(n.astext())]

    def uri_link(self, n: nodes.reference) -> Node:
        uri: str = n["refuri"]
        kids = self.inline_children(n)
        import re

        scheme = re.match(r"^([a-zA-Z][a-zA-Z0-9+.-]*):", uri)
        if scheme and not uri.lower().startswith(SAFE_SCHEMES):
            # urn:…, saml:…, about:blank: non sono link da pubblicare
            only_text = len(n.children) == 1 and n.astext() == uri
            return {"type": "inlineCode", "value": uri} if only_text else {"type": "emphasis", "children": kids}
        if not scheme:
            # link scritto come URL HTML verso un'altra pagina (../pagina.html, ../pagina)
            path, _, frag = uri.partition("#")
            page = self.html_target(path)
            if page is not None:
                url = self.rel(page) + ".md" + (f"#{frag}" if frag else "")
                return {"type": "link", "url": url, "children": kids}
        return {"type": "link", "url": uri, "children": kids}

    def html_target(self, path: str) -> str | None:
        if not path or path.startswith("/"):
            return None
        clean = path[:-5] if path.endswith(".html") else path.rstrip("/")
        for base in (self.dir, self.docname):  # builder html e dirhtml
            cand = posixpath.normpath(posixpath.join(base, clean))
            for c in (cand, posixpath.join(cand, "index")):
                if c in self.env.found_docs:
                    return c
        return None

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
            tgt = safe_label(target) if typ != "term" else target
            value = f"{label} <{tgt}>" if explicit else tgt
            return {"type": "crossReference", "kind": typ, "identifier": tgt.lower(), "label": tgt,
                    "children": [text(label)] if explicit else [],
                    "origin": {"kind": "role", "name": typ, "value": value}}
        self.report.note(f"riferimento {n.get('refdomain')}:{typ}", self.docname, n)
        return text(label)

    def download(self, n: nodes.Node) -> Node:
        target = n.get("reftarget", "")
        src = target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join(self.dir, target))
        return {"type": "link", "url": self.rel(self.report.asset(src)), "children": [text(n.astext())]}
