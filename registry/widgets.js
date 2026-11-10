import {officialCatalog} from "./catalog.js";
export const WIDGETS=Object.freeze(Object.fromEntries(officialCatalog.filter(app=>app.manifest?.widgets?.length).map(app=>[app.id,app.manifest.widgets.map(widget=>[widget.key,widget.name])])));
