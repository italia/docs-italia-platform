"""Estensione Sphinx di Docs Italia.

- Direttiva RST ``forum_italia`` (con gli alias ``discourse``).
- Builder ``docsitalia-ast``: per ogni pagina scrive l'AST MyST in
  ``pages/<pagina>.json``, più ``toc.json`` (dai toctree) e ``report.json``
  (nodi non convertiti, contenuto scartato, file da copiare).

Uso, senza eseguire il conf.py del repository:

    sphinx-build -C -b docsitalia-ast -D extensions=docs_italia_sphinx \\
        -D master_doc=index -D language=it <sorgente> <uscita>
"""

from __future__ import annotations

import json
import os
from typing import Any

from docutils import nodes
from docutils.parsers.rst import Directive, directives
from sphinx.application import Sphinx
from sphinx.builders import Builder

from .convert import Converter, Report, forum_node

__version__ = "0.0.0"


class ForumItalia(Directive):
    has_content = False
    option_spec = {"topic_id": directives.unchanged, "scope": directives.unchanged, "scrollable": directives.flag}

    def run(self) -> list[nodes.Node]:
        node = forum_node()
        topic = self.options.get("topic_id")
        node["topic_id"] = int(topic) if topic and str(topic).isdigit() else topic
        node["scope"] = self.options.get("scope")
        return [node]


class DocsItaliaAstBuilder(Builder):
    name = "docsitalia-ast"
    format = "json"
    epilog = "AST MyST scritto in %(outdir)s"

    def init(self) -> None:
        self.report = Report()

    def get_outdated_docs(self):  # type: ignore[override]
        return self.env.found_docs

    def get_target_uri(self, docname: str, typ: str | None = None) -> str:
        return docname + ".md"

    def prepare_writing(self, docnames: set[str]) -> None:
        pass

    def write_doc(self, docname: str, doctree: nodes.document) -> None:
        # doctree NON risolto: i riferimenti restano etichette
        raw = self.env.get_doctree(docname)
        tree = Converter(self.env, docname, self.report).document(raw)
        out = os.path.join(self.outdir, "pages", docname + ".json")
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "w", encoding="utf-8") as f:
            json.dump({"docname": docname, "tree": {"type": "root", "children": tree}}, f, ensure_ascii=False, indent=1)

    def toc(self) -> dict[str, Any]:
        """toc.json dai toctree: il primo numerato dà la numerazione, gli altri restano senza numero."""
        from sphinx import addnodes

        root = self.config.master_doc
        numbered_any = False

        def entries(docname: str, inherited: bool | None) -> list[dict[str, Any]]:
            doctree = self.env.get_doctree(docname)
            out: list[dict[str, Any]] = []
            for tt in doctree.findall(addnodes.toctree):
                numbered = bool(tt.get("numbered")) if inherited is None else inherited
                nonlocal numbered_any
                numbered_any = numbered_any or numbered
                for title, ref in tt.get("entries", []):
                    if ref == "self" or ref.startswith(("http://", "https://")):
                        continue
                    entry: dict[str, Any] = {"file": ref + ".md"}
                    if title:
                        entry["title"] = title
                    children = entries(ref, numbered)
                    if children:
                        entry["children"] = children
                    if not numbered:
                        entry["numbered"] = False
                    out.append(entry)
            return out

        chapters = entries(root, None)
        caption = None
        for tt in self.env.get_doctree(root).findall(addnodes.toctree):
            caption = caption or tt.get("caption")
        return {"root": root + ".md", **({"caption": caption} if caption else {}), "numbered": numbered_any, "chapters": chapters}

    def finish(self) -> None:
        with open(os.path.join(self.outdir, "toc.json"), "w", encoding="utf-8") as f:
            json.dump(self.toc(), f, ensure_ascii=False, indent=2)
        r = self.report
        with open(os.path.join(self.outdir, "report.json"), "w", encoding="utf-8") as f:
            json.dump(
                {
                    "unsupported": dict(r.unsupported),
                    "dropped": dict(r.dropped),
                    "where": r.where,
                    "assets": sorted(r.assets),
                },
                f,
                ensure_ascii=False,
                indent=2,
            )


def _skip(self: Any, node: nodes.Node) -> None:
    raise nodes.SkipNode


def setup(app: Sphinx) -> dict[str, Any]:
    # con gli altri builder (html, text, latex…) il nodo non produce nulla
    app.add_node(forum_node, html=(_skip, None), text=(_skip, None), latex=(_skip, None), man=(_skip, None), texinfo=(_skip, None))
    app.add_directive("forum_italia", ForumItalia)
    app.add_directive("discourse", ForumItalia)
    app.add_builder(DocsItaliaAstBuilder)
    return {"version": __version__, "parallel_read_safe": True, "parallel_write_safe": False}
