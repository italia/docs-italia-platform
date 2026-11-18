# Collegare un'organizzazione GitHub

Guida per chi amministra un'istanza di docs-italia-platform. Spiega come l'istanza raggiunge le organizzazioni GitHub che pubblicano documenti, con una **GitHub App** (consigliata) o con un **token**, e come aggiungere un'organizzazione dalla dashboard.

## In breve

1. L'istanza deve poter leggere i repository dell'organizzazione: si installa la GitHub App sull'organizzazione, oppure si usa un token che li raggiunge.
2. I webhook avvisano l'istanza a ogni push: con l'App sono già configurati, con il token si configurano a mano su ogni organizzazione.
3. In dashboard, **Organizzazioni** → **Aggiungi un'organizzazione**: la verifica controlla accesso, `italia-conf` e documenti, poi l'aggiunta avvia la prima sincronizzazione.

Da lì in poi l'organizzazione si aggiorna da sola: un push su `italia-conf` la risincronizza, un push sul branch della bozza o un nuovo tag di un documento accoda la build.

## Cosa deve avere l'organizzazione

- Un repository **`italia-conf`** con:
  - `publisher_settings.yml`: `name` e `description` obbligatori;
  - `projects_settings.yml`: i progetti, ognuno con `name`, `description` e l'elenco `documents` dei repository.
- Per ogni repository elencato, un **`document_settings.yml`** valido sul branch predefinito. Un documento senza resta tra i "non importati" e la dashboard lo segnala.

È la stessa struttura della piattaforma attuale: un'organizzazione già su docs.italia.it non deve cambiare nulla.

## App o token?

| | GitHub App | Token |
|---|---|---|
| Per chi | L'istanza nazionale e ogni istanza con più organizzazioni | Prove, istanze piccole, inizio del riuso |
| Chi lo configura | Una volta l'App sull'istanza, poi un proprietario di ogni organizzazione la installa | Chi crea il token |
| Webhook | Uno solo, nell'App, per tutte le organizzazioni | Uno per organizzazione, a mano |
| Limiti dell'API GitHub | Per installazione | 5.000 richieste l'ora in tutto |
| Scadenza | Nessuna: i token di installazione si rinnovano da soli | Quella scelta alla creazione: va rinnovato |
| Repository privati | Sì, se l'organizzazione li include nell'installazione | Solo con un token dedicato a quell'organizzazione |

L'istanza usa una sola modalità alla volta: se ci sono le variabili dell'App usa l'App, altrimenti il token. Senza nessuna delle due l'accesso è anonimo: solo repository pubblici e 60 richieste l'ora, adatto solo a una prova veloce.

## Con la GitHub App

### 1. Creare l'App (una volta per istanza)

Conviene che l'App appartenga all'organizzazione che gestisce l'istanza, non a una persona.

1. Sull'organizzazione che gestisce l'istanza: **Settings** → **Developer settings** → **GitHub Apps** → **New GitHub App**.
2. Compila:
   - **GitHub App name**: per esempio "Docs Italia". Il nome compare nelle organizzazioni che la installano.
   - **Homepage URL**: l'indirizzo del sito dell'istanza.
   - **Webhook**: attivo. **Webhook URL**: `<PUBLIC_URL>/api/webhooks/github`, per esempio `https://api.docs.italia.it/api/webhooks/github`. **Webhook secret**: una stringa casuale lunga (per esempio `openssl rand -hex 32`); è lo stesso valore di `GITHUB_WEBHOOK_SECRET`.
3. **Permessi**, nella sezione *Repository permissions*:
   - **Contents: Read-only**: leggere `italia-conf`, i file dei documenti, branch e tag, scaricare la sorgente;
   - **Metadata: Read-only**: obbligatorio, GitHub lo attiva da solo.

   Per ora non serve altro. Quando arriveranno le anteprime delle pull request e lo stato delle build sui commit serviranno anche *Pull requests* e *Commit statuses*. Le organizzazioni dovranno approvare i permessi nuovi, e la dashboard li segnalerà.
4. **Subscribe to events**: **Push**. Si può aggiungere già *Pull request*: oggi l'istanza lo riceve e lo registra senza fare altro.
5. **Where can this GitHub App be installed?**: **Any account**, così possono installarla anche le altre amministrazioni.
6. **Create GitHub App**. Nella pagina dell'App:
   - annota l'**App ID** (sezione *About*);
   - in **Private keys**, **Generate a private key**: si scarica un file `.pem`. È la credenziale dell'App: va custodita come una password e non entra nel repository.

### 2. Configurare l'istanza

```sh
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY_FILE=/run/secrets/github-app.pem   # oppure GITHUB_APP_PRIVATE_KEY con il contenuto del file
GITHUB_WEBHOOK_SECRET=…                                   # lo stesso valore dato all'App
PUBLIC_URL=https://api.docs.italia.it                     # indirizzo pubblico del server, da cui si ricava l'URL dei webhook
```

Dopo il riavvio, in dashboard **Stato dei collegamenti** → gruppo *GitHub*:
- **Modalità di accesso**: GitHub App con il suo ID;
- **Chiave privata**: "JWT valido" con il nome dell'App. Se la chiave è sbagliata o di un'altra App, compare qui l'errore.

### 3. Installare l'App su un'organizzazione

Lo fa un **proprietario** dell'organizzazione (*owner*), non basta essere membro.

1. Apri la pagina pubblica dell'App, `https://github.com/apps/<nome-dell-app>`, e premi **Install**, oppure **Configure** se è già installata altrove.
2. Scegli l'organizzazione.
3. Accesso ai repository:
   - **All repositories**: il più semplice, i documenti nuovi si vedono subito;
   - **Only select repositories**: va bene, ma vanno inclusi `italia-conf` e **tutti** i repository dei documenti, e ogni documento nuovo va aggiunto all'installazione. Un repository escluso risulta "non trovato".
4. **Install**.

L'App si installa su un'**organizzazione**: con l'App non si possono collegare account personali.

### 4. Aggiungere l'organizzazione

Vai in dashboard, sezione **Aggiungi un'organizzazione** (vedi più sotto). Nella verifica, **Installazione su `<organizzazione>`** deve essere "installata", con i permessi concessi.

## Con un token

### 1. Creare il token

Si usa un token *fine-grained*: **Settings** (del proprio account) → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.

- **Token name**: per esempio "Docs Italia – istanza".
- **Expiration**: la più lunga ammessa dalla policy dell'organizzazione. La dashboard avvisa 30 giorni prima della scadenza; da scaduto, l'istanza smette di leggere i repository finché non si sostituisce.
- **Repository access**, due casi:
  - **documenti pubblici** (il caso di Docs Italia): **Public repositories (read-only)**. Il token legge tutti i repository pubblici di GitHub, di qualunque organizzazione, e non servono permessi in più. Un solo token basta per tutte le organizzazioni.
  - **repository privati**: come *Resource owner* va scelta l'organizzazione, poi **Only select repositories** con `italia-conf` e i documenti, e in *Repository permissions* **Contents: Read-only**. Un token fine-grained vale per un solo proprietario, e l'istanza ne usa uno solo: con il token, i repository privati si possono leggere per una sola organizzazione. Per più organizzazioni con repository privati serve l'App. L'organizzazione può richiedere che un proprietario approvi il token prima che funzioni.

Conviene che il token sia di un account di servizio dell'ente che gestisce l'istanza, non di una persona: se quella persona lascia l'organizzazione, il token smette di funzionare.

### 2. Configurare l'istanza

```sh
GITHUB_TOKEN=github_pat_…
GITHUB_WEBHOOK_SECRET=…        # stringa casuale lunga, la stessa dei webhook delle organizzazioni
PUBLIC_URL=https://api.docs.italia.it
```

Le variabili dell'App (`GITHUB_APP_ID`…) non devono esserci: hanno la precedenza sul token.

In **Stato dei collegamenti** → *GitHub*:
- **Modalità di accesso**: token, con le ultime quattro cifre;
- **Token**: valido, di chi, e la scadenza;
- **Limiti dell'API**: richieste rimaste nell'ora.

### 3. Configurare i webhook su ogni organizzazione

Lo fa un proprietario dell'organizzazione: **Settings** dell'organizzazione → **Webhooks** → **Add webhook**.

- **Payload URL**: `<PUBLIC_URL>/api/webhooks/github`.
- **Content type**: **application/json**. Con l'altro formato l'istanza non legge l'evento.
- **Secret**: il valore di `GITHUB_WEBHOOK_SECRET`.
- **Which events?**: **Let me select individual events** → **Pushes**, e se vuoi **Pull requests**.
- **Active**, poi **Add webhook**.

GitHub manda subito un evento di prova (*ping*). Si vede in dashboard alla pagina **Webhook**, e in GitHub nella scheda *Recent Deliveries* con la risposta 200. Una consegna con risposta 401 vuol dire che il secret non coincide.

Senza webhook l'organizzazione funziona lo stesso, ma non si aggiorna da sola: bisogna premere **Sincronizza** in dashboard dopo ogni modifica di `italia-conf`, e ricostruire a mano le versioni.

### 4. Aggiungere l'organizzazione

Come con l'App: sezione **Aggiungi un'organizzazione** della dashboard.

## Aggiungere l'organizzazione dalla dashboard

**Organizzazioni** → **Aggiungi un'organizzazione**.

1. Scrivi il nome dell'organizzazione come compare su GitHub (`AgID`, `italia`, `teamdigitale`…) e premi **Verifica**. Le maiuscole non contano. La verifica non cambia nulla, e mostra:
   - **accesso**: modalità, installazione dell'App sull'organizzazione o validità del token, limiti dell'API;
   - **`italia-conf`**: se esiste, se l'istanza lo vede e se i due file sono validi, con gli errori riga per riga del formato;
   - **documenti**: per ogni repository elencato, se è stato trovato, se ha `document_settings.yml` e se è archiviato su GitHub.
2. Se `italia-conf` è valido, premi **Aggiungi e sincronizza**. I documenti mancanti non bloccano l'aggiunta: compariranno tra i "non importati".
3. La sincronizzazione va in coda (**Coda dei lavori**). Crea amministrazione, progetti e documenti e accoda la build della **bozza** di ogni documento. Quando una build è pubblicata, il documento compare sul sito.

Aggiunta e sincronizzazioni finiscono nel **Registro**, con l'email di chi le ha fatte.

**Le release già pubblicate** sulla piattaforma attuale non arrivano dalla sincronizzazione, che crea solo le bozze. Si importano con il comando `seed` del server e l'inventario dell'API di docs.italia.it (`inventario/docs-italia-api-snapshot.json`). Le release nuove arrivano dai webhook a ogni tag.

La stessa operazione si può fare senza dashboard, con la sessione o con `ADMIN_TOKEN`:

```sh
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://api.docs.italia.it/api/admin/publishers/check/AgID      # verifica
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"owner":"AgID"}' https://api.docs.italia.it/api/admin/publishers                                 # aggiunta
```

`ORGANIZATIONS` (per esempio `ORGANIZATIONS=AgID,italia,teamdigitale`) è facoltativa: fa controllare in **Stato dei collegamenti** anche le organizzazioni non ancora aggiunte, utile per vedere se l'App è installata prima di aggiungerle.

## Problemi frequenti

| Cosa si vede | Perché | Cosa fare |
|---|---|---|
| Verifica: "`italia-conf` non trovato" con l'App | L'App non è installata sull'organizzazione, oppure è installata su repository scelti senza `italia-conf` | Installare l'App, o aggiungere `italia-conf` all'installazione |
| Verifica: "`italia-conf` non trovato" con il token | Token senza accesso: per repository privati serve un token di quell'organizzazione | Controllare *Repository access* del token |
| Stato: "Installazione su X: App non installata" | Come sopra | Un proprietario dell'organizzazione installa l'App |
| Documento "non trovato" | Il repository non esiste con quel nome, è fuori dall'installazione dell'App o è privato | Correggere `projects_settings.yml` o l'installazione |
| Documento "senza `document_settings.yml`" | Il file manca sul branch predefinito | Aggiungerlo al repository del documento |
| Webhook con risposta 401 | Secret diverso da `GITHUB_WEBHOOK_SECRET` | Allineare il secret |
| Webhook "publisher sconosciuto" | L'organizzazione non è ancora stata aggiunta | Aggiungerla dalla dashboard |
| Stato: "Token: scade tra N giorni" | Scadenza del token fine-grained | Crearne uno nuovo e sostituire `GITHUB_TOKEN` |
| Limiti dell'API quasi esauriti | Troppe sincronizzazioni o build in poco tempo con il token | Passare alla GitHub App |

## In locale (sviluppo e demo)

Con `FORGE_LOCAL_ROOT` l'istanza legge i clone in `<radice>/<organizzazione>/<repository>` invece di GitHub: niente App, token né webhook. Per aggiungere un'organizzazione si clonano `italia-conf` e i documenti in `<radice>/<organizzazione>/`, poi si usa la stessa **Aggiungi un'organizzazione** della dashboard.
