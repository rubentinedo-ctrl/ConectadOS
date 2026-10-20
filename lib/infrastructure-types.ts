import type {ResourceBackupsReport} from './resource-backup-types';
import type {BackupProtectionReport} from './backup-protection-types';
import type {ExternalObserverReport} from './external-observer-types';
import type {HostTelemetryReport} from './host-telemetry-types';
import type {BillingReport} from './billing-types';
export type ObservedProvider='Coolify'|'Vercel'|'Cloudflare'|'Supabase'|'Hostinger';
export type InfrastructureResource={id:string;name:string;type:string;status:string;domains?:string[];framework?:string|null;recordCount?:number;paused?:boolean;region?:string|null;organizationId?:string|null;databaseVersion?:string|null;plan?:string|null;osTemplate?:string|null;cpuCount?:number|null;memoryMB?:number|null;diskMB?:number|null;bandwidthMB?:number|null;addresses?:string[]};
export type ServiceComponent={id:string;name:string;type:'application'|'database';status:string;image:string|null;excludedFromStatus:boolean};
export type ServiceDetail={serviceId:string;components:ServiceComponent[];source:string;checkedAt:number|null;expiresAt:number|null;attemptedAt:number;error:string|null};
export type InfrastructureSnapshot={resources:InfrastructureResource[];source:string;checkedAt:number;coverage:string;expiresAt?:number;records?:DNSRecord[];metrics?:ProviderMetric[];serviceDetails?:ServiceDetail[];applicationDeployments?:{applicationId:string;count:number|null;source:string;checkedAt:number|null;expiresAt:number|null;error:string|null}[];accountServers?:{id:string;name:string}[]|null};
export type CoolifyConnection={url:string;snapshot:InfrastructureSnapshot|null;error:string|null;attempted:number|null;hasToken:boolean};
export type CollectorStatus={enabled:boolean;heartbeat:number|null;error:string|null;intervalMs:number};
export type HistorySample={checkedAt:number;total:number;attention:number;warnings?:{name:string;kind:'stopped'|'unhealthy'|'components'|'reading';components:{name:string;state:string}[];detailStale:boolean}[]};
export type ResourceLogo={ref:string;provider:ObservedProvider;resourceId:string;revision:string;updatedAt:number};
export type CoolifyState={platforms?:import('./workspace-types').PlatformsReport;resourceBackups?:ResourceBackupsReport;backupProtection?:BackupProtectionReport;externalObserver?:ExternalObserverReport;hostTelemetry?:HostTelemetryReport;billing?:BillingReport;connection:CoolifyConnection|null;collector:CollectorStatus;history:HistorySample[];integrations?:ProviderConnection[];logos?:ResourceLogo[];probes?:WebProbe[];incidents?:IncidentReport;notifications?:NotificationReport;topology?:TopologyReport;organization?:OrganizationReport};

export type DNSRecord={id:string;zoneId:string;name:string;type:string;value:string|null;valueRedacted:boolean;proxied:boolean|null;ttl:number|null;priority:number|null};
export type ProviderConnection={provider:Exclude<ObservedProvider,'Coolify'>;scope:string;snapshot:InfrastructureSnapshot|null;error:string|null;attempted:number|null;hasToken:boolean};

export type ProviderMetric={name:string;unit:string;points:{at:number;value:number}[]};

export type WebProbeResult={source:string;method:'HEAD';checkedAt:number;expiresAt:number;kind:'response'|'redirect'|'protected'|'unsupported'|'http-error'|'unreachable'|'blocked';httpStatus:number|null;durationMs:number|null;certificateExpiresAt:number|null;error:string|null;lastResponse:{checkedAt:number;httpStatus:number;durationMs:number|null}|null};
export type WebProbe={id:string;label:string;url:string;enabled:boolean;revision:number;snapshot:WebProbeResult|null;history:WebProbeResult[]};

export type Incident={id:string;revision:string;state:'open'|'acknowledged'|'resolved'|'monitoring-ended'|'reclassified';payload:{findingId:string;provider:string;resourceId:string|null;probeId:string|null;title:string;detail:string;severity:string;observedAt:number|null};firstSeen:number;lastSeen:number;acknowledgedAt:number|null;closedAt:number|null;closeReason:string|null;events:{event:string;at:number}[]};
export type IncidentReport={inboxRevision?:string;tracking:boolean;observing:boolean;delivery:'local-only';counts:Record<Incident['state'],number>;total:number;items:Incident[]};
export type NotificationState='queued'|'sending'|'accepted'|'failed'|'uncertain'|'cancelled';
export type NotificationPolicy={revision:string;configured:boolean;categories:string[];providers:string[];minimumMinutes:number;intervalMinutes:number;repeatHours:number;maxPerDay:number;categoriesAvailable:Record<string,string>;providersAvailable:string[]};
export type NotificationReport={policy:NotificationPolicy;provider:'Resend';revision:string;sender:string|null;recipient:string|null;includeDetails:boolean;dailyLimit:number;enabled:boolean;hasToken:boolean;ready:boolean;testAcceptedAt:number|null;testNeedsRenewal:boolean;mutedUntil:number|null;observing:boolean;remainingToday:number;counts:Record<NotificationState,number>;deliveries:{id:string;currentConfiguration:boolean;kind:'test'|'warning';state:NotificationState;createdAt:number;attempts:number;acceptedAt:number|null;error:string|null}[];scope:'local-process'};
export type RelationKind='depends-on'|'hosted-in'|'resolves-to'|'backed-up-in'|'contained-in'|'domain-match';
export type TopologyNode={ref:string;provider:ObservedProvider;kind:'resource'|'component'|'dns';id:string;parentId:string|null;name:string;type:string;status:string;source:string;checkedAt:number|null;stale:boolean;lifecycle?:{state:string;label:string;checkedAt:number;expiresAt:number;source:string}|null};
export type TopologyEdge={id:string;fromRef:string;toRef:string;kind:RelationKind;origin:'observed'|'declared';evidence:string;source:string;checkedAt:number|null;stale:boolean;missing:boolean;note:string;revision:string|null;createdAt:number|null;updatedAt:number|null};
export type TopologyReport={revision:string;nodes:TopologyNode[];edges:TopologyEdge[];coverage:{nodeLimit:number;edgeLimit:number;manualLimit:number;omittedNodes:number;omittedEdges:number};scope:'local-inventory'};

export type InventoryProject={id:string;name:string;description:string;color:'cyan'|'blue'|'amber'|'coral'|'mint';revision:string;createdAt:number;updatedAt:number};
export type ResourceAssignment={ref:string;projectId:string|null;tags:string[];revision:string;updatedAt:number;missing:boolean;stale:boolean};
export type OrganizationReport={connectionRevision:string;projects:InventoryProject[];assignments:ResourceAssignment[];limits:{projects:number;annotations:number;tagsPerResource:number};scope:'local-organization'};
