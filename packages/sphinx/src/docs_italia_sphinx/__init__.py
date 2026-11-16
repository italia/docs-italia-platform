"""Estensione Sphinx di Docs Italia (ossatura).

Compiti previsti:
- builder "docsitalia" che serializza il doctree risolto nel pacchetto di Docs Italia;
- conversione doctree -> AST MyST, con nodo HTML di ripiego per i nodi non ancora mappati;
- direttive e ruoli di Docs Italia (forum_italia, plantuml, only, ruoli HTTP) per l'RST.
"""

__version__ = "0.0.0"


def setup(app):
    """Punto di ingresso dell'estensione Sphinx."""
    return {"version": __version__, "parallel_read_safe": True, "parallel_write_safe": True}
