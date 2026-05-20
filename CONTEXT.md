# Codemaps

Codemaps treats a codebase as a navigable spatial map so people and agents can refer to code by stable regions and coordinates.

## Language

**Code Map**:
A navigable spatial representation of a codebase. It is the primary surface for panning, zooming, locating code, and naming regions.
_Avoid_: Huge file, file tree replacement

**Stable Map**:
A **Code Map** whose existing places remain fixed as the codebase changes. A Stable Map lets people and agents return to known Map Addresses over time.
_Avoid_: Auto-reflowing map, disposable layout

**Map Sidecar**:
A persisted description of the stable base geography of the **Code Map**. The Map Sidecar stores path-keyed Folders and Files, enough information to resolve Map Addresses, and the Code Plane transform, without storing volatile overlays such as live Agent Positions.
_Avoid_: Cache file, activity log

**Tile Cache**:
A derived cache or index used to load visible Tiles efficiently. The Tile Cache is generated from the Map Sidecar, uses geohash prefixes as tile addresses, and does not serve as the canonical map.
_Avoid_: Source of truth, committed geography

**Named Places Store**:
The persisted collection of Named Places, Drawn Selections, and Covering Sets. It changes independently from the Map Sidecar.
_Avoid_: Map sidecar section, label cache

**Activity Stream**:
The in-memory timeline of Agent Positions and Activity States that powers the real-time map overlay. It is separate from the Map Sidecar because agent activity changes without changing the Code Map. Codemaps may periodically append Activity Stream events to a JSONL Activity Archive, but the archive is not read on the hot path.
_Avoid_: Map layout history, cursor log

**Activity Archive**:
A JSONL append-only record of Activity Stream events written from time to time outside the real-time request path. The Activity Archive is allowed to grow until the developer chooses to rotate or delete it; Codemaps does not put a hard file-size gate in front of telemetry.
_Avoid_: Real-time source of truth, capped activity database

**Activity Producer**:
A tool, hook, watcher, or agent integration that reports Agent Positions into the Activity Stream. Activity Producers are best-effort and must never block code reading, editing, testing, or serving when telemetry cannot be delivered.
_Avoid_: Required build step, blocking status reporter

**Viewport State**:
The current view of the **Code Map**, including pan, zoom, selected layers, and temporary drawings. Viewport State is not part of the stable map.
_Avoid_: Map data, persisted geography

**File**:
The first stable unit placed on the **Code Map**. A file occupies a stable area and contains source content that can be revealed as the map zooms in.
_Avoid_: Blob, source chunk

**Source Content**:
The code text inside a **File**. Source Content belongs inside the File's area on the **Code Map** rather than becoming a separate top-level map unit.
_Avoid_: Raw text blob, pasted code

**Binary Content**:
Non-text content inside a **File**. Binary Content is not a focus of the first Code Map and does not expose Line Coordinates.
_Avoid_: Hidden asset, fake source text

**Code File**:
A **File** with a known coding or text extension that belongs in the first source-oriented **Code Map**. Code Files expose Source Content and Line Coordinates.
_Avoid_: Any filesystem file, arbitrary asset

**Line Coordinate**:
A position inside a **File** based on the normal top-to-bottom order of its **Source Content**. Line Coordinates let people and agents refer to specific ranges inside a File area.
_Avoid_: Text pixel, packed text location

**File Area**:
The amount of space a **File** occupies on the **Code Map**. File Area reflects the length of its **Source Content**, so larger files occupy more visible space.
_Avoid_: Marker size, arbitrary weight

**Token Overlay**:
An optional Map Layer showing estimated token cost or density for Code Files or Regions. Token Overlay data helps agent planning but does not determine base File Area, and is cached separately from the Map Sidecar with tokenizer and content identity.
_Avoid_: Base size, canonical geometry

**Folder**:
A filesystem container that groups related **Files** and other **Folders** on the **Code Map**. Folder structure is the first source of neighbourhoods on the map.
_Avoid_: Directory tree node, namespace bucket

**Map Order**:
The deterministic order used to arrange children inside a **Folder** when creating the initial **Code Map**. The first Map Order is lexical path order, with Folders before Files.
_Avoid_: Filesystem order, timestamp order

**Map Inclusion**:
The rule for deciding which Files and Folders appear on the **Code Map**. The first Map Inclusion rule follows the repository's gitignore rules, then includes known Code File extensions so the map reflects the source files people and agents normally navigate.
_Avoid_: Separate ignore policy, generated-file guesswork

**Map Boundary**:
The set of project paths included in the **Code Map** by default. The first Map Boundary is the set of known Code Files remaining after gitignore filtering.
_Avoid_: Whole checkout, every file on disk

**Growth Area**:
Reserved or reusable space inside a **Folder** where new Files can be placed without moving existing places on the **Stable Map**.
_Avoid_: Overflow bucket, random free space

**Repack**:
A deliberate operation that rearranges part of the **Code Map** when a Folder region can no longer absorb changes cleanly. A Repack is explicit because it can change existing Map Addresses.
_Avoid_: Automatic reflow, background rearrangement

**Tile**:
A visible rectangular portion of the **Code Map** addressed by geohash prefix at a particular Map Level. Tiles are how the map is viewed and loaded in pieces.
_Avoid_: Card, panel

**Map Layer**:
A distinct visual and queryable layer of the **Code Map**, such as base geography, Named Places, Drawn Selections, Agent Positions, or Overlap. Layers make it clear which information comes from code structure and which information is added on top.
_Avoid_: Canvas group, rendering pass

**Coordinate**:
A stable position on the **Code Map** that can be used by people and agents to locate Files, Regions, or activity. Coordinates must be precise enough for agents and readable enough for human navigation.
_Avoid_: Path-only location

**Code Plane**:
The normalized spatial domain of the **Code Map**. Codemaps can use standard geohash latitude and longitude internally while presenting Coordinates as code-space locations rather than Earth geography.
_Avoid_: Fake earth, literal latitude and longitude

**Map Address**:
A durable reference to a place on the **Code Map**. A Map Address is backed by a geohash coordinate and can point to a Region, File, or Line Coordinate while also carrying human-readable breadcrumbs.
_Avoid_: Link, locator string

**Deep Link**:
A portable URI form of a **Map Address**. The canonical Deep Link shape is `codemap://<mapLevel>/<geohash>` with optional path, line, or name metadata.
_Avoid_: Web route only, opaque URL

**Address Resolver**:
A stable interface that converts ordinary code locations, such as file paths and line ranges, into **Map Addresses**. Address Resolvers let tools and agents report activity without knowing how the map is rendered.
_Avoid_: Renderer callback, path parser

**Address Target**:
The kind of place a **Map Address** refers to, such as a Region, Folder, File, or Line Coordinate.
_Avoid_: Result type, entity kind

**Breadcrumb**:
A human-readable path through the **Code Map** to a **Map Address**. Breadcrumbs help people understand an address without replacing the underlying geohash coordinate.
_Avoid_: Raw geohash label, folder path only

**Map Level**:
A named scale of the **Code Map** represented by geohash precision. The first Map Levels are world, region, folder, file, code, and lineRange. Tile loading uses the same Map Level to geohash precision mapping as addresses, selections, names, and activity.
_Avoid_: Zoom only, arbitrary precision

**Region**:
A named area of the **Code Map**. Regions can represent business domains, features, or other meaningful code neighbourhoods.
_Avoid_: Folder, category

**Named Place**:
A saved name for a place on the **Code Map**. A Named Place is associated with either a Drawn Selection or a specific geohash-backed Map Address, and can be created through the same naming interface whether the caller is a person or an agent. Multiple Named Places can point to the same area.
_Avoid_: Human bookmark, agent label

**Overlap**:
The condition where multiple Named Places, Drawn Selections, or Regions cover the same part of the **Code Map**. Overlap is allowed and should be visible.
_Avoid_: Naming conflict, invalid intersection

**Naming Interface**:
The shared way to assign names to places on the **Code Map**. The Naming Interface is caller-neutral, so humans and agents use the same concept when naming map areas.
_Avoid_: Annotation tool, agent metadata

**Search Area**:
A **Region** used as the active boundary for investigation, navigation, or agent work.
_Avoid_: Scope, filter

**Drawn Selection**:
A user-created shape on the **Code Map** that identifies an area of interest. A Drawn Selection preserves the original geometry while also carrying a derived Covering Set for lookup.
_Avoid_: Canvas annotation, visual-only markup

**Covering Set**:
The set of geohash-backed **Map Addresses** that approximate a **Drawn Selection** or Region for lookup and navigation. A Covering Set is used by the algorithm while the original selection remains meaningful to people.
_Avoid_: Pixel mask, screenshot area

**Resolved Target**:
A Region, File, or Line Coordinate currently matched by a **Drawn Selection** or **Covering Set**. Resolved Targets can change as the Code Map changes.
_Avoid_: Permanent selection member, static file match

**Selection Resolution**:
The process of turning a **Drawn Selection** or **Covering Set** into Resolved Targets. Selection Resolution uses geohash coverage for coarse lookup, refines against real map geometry, and follows the active Map Level: broad levels resolve to Regions or Files, while code-level selections can resolve to Line Coordinates.
_Avoid_: Fixed hit test, pixel selection

**Agent Position**:
An agent's current **Map Address** while it reads, edits, reasons about, or verifies code. Agent Positions are activity overlays on the Code Map rather than part of the map layout.
_Avoid_: Avatar location, cursor only

**Activity State**:
The kind of work an agent is doing at an **Agent Position**, such as reading, editing, testing, or reviewing. Activity States describe visible work in progress; legacy blocked events are normalized to reviewing rather than becoming a blocking workflow state.
_Avoid_: Status text only, task label

## Example Dialogue

Developer: "Show me the Search Area for authentication."

Domain expert: "That Search Area is a Region on the Code Map. It contains the Files currently associated with authentication work."

Developer: "Can an agent navigate there without using paths?"

Domain expert: "Yes. The agent can use Coordinates and Regions on the Code Map, then resolve the relevant Files from that position."

Developer: "Why are these files near each other?"

Domain expert: "In the first version, Files are near each other because they share Folder structure. Later, another projection can add stronger relationship signals."

Developer: "Where does the actual code text live?"

Domain expert: "Source Content lives inside each File area. At low zoom, the File appears as a shape or label; at high zoom, its contents become visible."

Developer: "Where do images or other binary files go?"

Domain expert: "Binary Content is not the focus of the first Code Map. The first map prioritises Code Files with known coding or text extensions."

Developer: "Does the code get spatially packed to fill the File area?"

Domain expert: "No. Source Content keeps its normal top-to-bottom layout inside the File. Specific ranges are addressed with Line Coordinates."

Developer: "Why is this File larger than that one?"

Domain expert: "File Area reflects Source Content length. Larger files take up more map space, and Folder areas grow from the Files they contain."

Developer: "Should token count make a File bigger?"

Domain expert: "No. The first File Area is based on line count. Token Overlay can show context cost without changing base geography."

Developer: "Where do token counts live?"

Domain expert: "Token Overlay data is cached separately from the Map Sidecar and keyed by tokenizer identity and content identity."

Developer: "Who is the Coordinate for?"

Domain expert: "Both people and agents. The algorithm must produce stable positions, and the resulting Map Addresses must be useful for navigation, discussion, and code changes."

Developer: "Are these real latitude and longitude coordinates?"

Domain expert: "No. The Code Plane may use standard geohash latitude and longitude internally, but people see code-space Coordinates and Map Addresses."

Developer: "Do people need to read raw geohashes?"

Domain expert: "No. Map Addresses are geohash-backed, but people navigate with Breadcrumbs layered over those coordinates."

Developer: "How should a map location appear in logs or agent messages?"

Domain expert: "Use a Deep Link such as `codemap://lineRange/u4pruydqqvj?path=src/search/index.ts&lines=80-120`, so tools and people can resolve the same Map Address."

Developer: "What does a short or long geohash prefix mean?"

Domain expert: "It represents a Map Level. Short prefixes describe broad Regions; longer prefixes narrow toward File areas and Line Coordinates."

Developer: "If I draw around part of the map, what does that mean?"

Domain expert: "That is a Drawn Selection. It can be translated into a Covering Set so the system can identify which Regions, Files, or Line Coordinates are inside it."

Developer: "Does a Drawn Selection permanently mean the same files?"

Domain expert: "No. The Drawn Selection preserves the map area. Resolved Targets are recalculated from the current Code Map."

Developer: "If a drawing only cuts through part of a File, what is selected?"

Domain expert: "Selection Resolution depends on the active Map Level. At broad levels it resolves to Regions or Files; at code level it can resolve to Line Coordinates."

Developer: "Why not just trust the geohash cells?"

Domain expert: "Geohash coverage is the coarse lookup. Selection Resolution still refines against real map geometry so edge selections feel accurate."

Developer: "Should the map rearrange itself when files change?"

Domain expert: "No. Codemaps should behave like a real map: existing places stay put, while new or removed Files are handled without moving the rest of the world by default."

Developer: "Where does a new File go?"

Domain expert: "A new File is placed in the Growth Area of its Folder. If the Folder cannot absorb it cleanly, the team can choose an explicit Repack."

Developer: "Why does this Folder appear before that File?"

Domain expert: "Initial placement follows Map Order: lexical path order, with Folders before Files, so the same codebase produces the same Code Map."

Developer: "What gets left off the map?"

Domain expert: "The first Map Inclusion rule follows gitignore filtering, then includes known Code File extensions rather than arbitrary filesystem files."

Developer: "Does every file in the checkout appear on the map?"

Domain expert: "No. The Map Boundary focuses on navigable project code and excludes generated, vendor, cache, or noisy paths by default."

Developer: "What does it mean when an agent appears on the map?"

Domain expert: "The marker shows the agent's current Agent Position and Activity State. It points to the Map Address the agent is reading, editing, reasoning about, or verifying."

Developer: "How does a tool know where an edit happened on the map?"

Domain expert: "It uses an Address Resolver to turn a file path and line range into a Map Address. The same stable interface can be used by hooks, agents, and the UI."

Developer: "What does the Address Resolver return?"

Domain expert: "It returns a Map Address with a geohash coordinate, Breadcrumb, Address Target, and map bounds for highlighting or navigation."

Developer: "Who is allowed to name an area?"

Domain expert: "Naming goes through one Naming Interface. A person may call it directly, and an agent may use the same interface later."

Developer: "What does a name attach to?"

Domain expert: "A Named Place attaches to a Drawn Selection or to a specific geohash-backed Map Address. It does not attach directly to a static list of files."

Developer: "Can the same area have more than one name?"

Domain expert: "Yes. Names are labels over places, so the same area can be meaningful in several conversations."

Developer: "What if two named areas overlap?"

Domain expert: "Overlap is allowed, but it should be obvious. A point inside overlapping areas can show every matching name, ordered by specificity."

Developer: "Do folder regions and named regions look the same?"

Domain expert: "No. They belong to different Map Layers, so base geography remains distinct from names, drawings, overlaps, and live agent activity."

Developer: "What belongs in the saved map file?"

Domain expert: "The Map Sidecar stores stable base geography, the Code Plane transform, and address resolution data. Volatile overlays, such as live Agent Positions, are stored separately."

Developer: "Are rendered Tiles the source of truth?"

Domain expert: "No. The Map Sidecar is canonical. The Tile Cache is derived from it for fast viewport loading."

Developer: "How are Tiles addressed?"

Domain expert: "Tiles use geohash prefixes as their addresses. Codemaps avoids a second tile-coordinate system unless scale later proves it necessary."

Developer: "Does tile loading use different coordinates from Map Addresses?"

Domain expert: "No. Tile loading uses the same Map Level to geohash prefix mapping as Map Addresses, Drawn Selections, Named Places, and Agent Positions."

Developer: "Where do names and live agent movement go?"

Domain expert: "Named Places live in the Named Places Store. Agent movement lives in the Activity Stream. Current pan, zoom, and temporary drawings live in Viewport State."
