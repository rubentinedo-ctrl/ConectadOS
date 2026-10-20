export type ExplorerCategory='databases'|'servers'|'domains'|'deployments'|'platforms';
export type PlatformEntry={id:string;name:string;category:string;accountUrl:string;description:string;projectId:string|null;revision:string;archived:boolean;createdAt:number;updatedAt:number};
export type PlatformsReport={items:PlatformEntry[];limit:number;checkedAt:number;scope:'manual-register'};
export type ExplorerItem={key:string;name:string;hosting?:string|null;provider:string;category:ExplorerCategory;type:string;state:'healthy'|'warning'|'unknown'|'prepared';ref:string|null;checkedAt:number|null;source:string;fields:{label:string;value:string}[];resourceId:string;parentId:string|null};
export type ReportSection={name:string;headers:string[];rows:(string|number|null)[][];note:string};
export type WorkspaceReport={title:string;generatedAt:number;demo:boolean;privateNames:boolean;sections:ReportSection[];analysis?:ReportAnalysis;limits:string};

export type ReportAnalysis={headline:string;lead:string;verdict:string;tone:string;stats:{label:string;value:string;detail:string}[];charts:{title:string;description:string;unit:string;kind:string;rows:{label:string;value:number|null;color:string;at?:number}[]}[];findings:{tone:string;title:string;observation:string;meaning:string;next:string}[];actions:{title:string;detail:string}[];sources:{name:string;at:number|null;fresh:boolean;status?:string}[];method:string};
