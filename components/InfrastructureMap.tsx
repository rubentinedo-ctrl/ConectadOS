"use client";

import { useState, type CSSProperties } from "react";
import {
  Server,
  Cloud,
  Database,
  HardDrive,
  Globe,
  Triangle,
  Mail,
  Cpu,
  Bot,
  Mic,
  Pause,
  Play,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Maximize2,
  Minimize2,
  ArrowUpRight,
} from "lucide-react";
import { resources, type Resource } from "@/lib/preview/fixtures";
import "./infrastructure-map.css";

const nodes = [
  { id: "dns", x: 15, y: 22, title: "Cloudflare", sub: "DOMINIOS · DNS", icon: Cloud },
  { id: "hub-web", x: 48, y: 13, title: "Vercel", sub: "HUB · WEB", icon: Triangle },
  { id: "fin-web", x: 80, y: 22, title: "Vercel", sub: "NOVA · WEB", icon: Triangle },
  { id: "vps", x: 48, y: 48, title: "VPS KVM 4", sub: "HOSTINGER · COOLIFY", icon: Server },
  { id: "hub-db", x: 15, y: 61, title: "Atlas", sub: "COOLIFY · DATABASE", icon: Database },
  { id: "fin-db", x: 80, y: 61, title: "Nova", sub: "COOLIFY · DATABASE", icon: Database },
  { id: "drive", x: 31, y: 87, title: "Google Drive", sub: "RESPALDOS", icon: HardDrive },
  { id: "dentia", x: 65, y: 87, title: "Clinic Demo", sub: "COOLIFY · API", icon: Cpu },
];
// Illustrative relationships, not discovered network topology or live traffic.
const edges = [
  ["dns", "hub-web"],
  ["dns", "fin-web"],
  ["hub-web", "hub-db"],
  ["fin-web", "fin-db"],
  ["vps", "hub-db"],
  ["vps", "fin-db"],
  ["vps", "dentia"],
  ["vps", "drive"],
];
const responses = {
  salud:
    "En este ejemplo, Clinic Demo tiene una señal de lentitud y la copia de Drive tiene un dato vencido. Son escenarios ficticios para probar cómo el asistente explicaría una alerta. Todavía no puedo consultar tu infraestructura real.",
  dominios:
    "El mapa ilustra cómo un dominio en Cloudflare llega a una aplicación en Vercel y a su base en Coolify. La siguiente etapa incorporará todas tus zonas y subdominios, su destino, HTTPS y fechas de comprobación.",
  voz: "Mejora registrada: pulsar para hablar, revisar la transcripción y recibir una respuesta por voz. El asistente consultará fuentes verificadas y pedirá aprobación antes de ejecutar cambios. El micrófono no está conectado en este prototipo.",
};

export function InfrastructureMap({ onDetail }: { onDetail: (resource: Resource) => void }) {
  const [selected, setSelected] = useState("vps");
  const [paused, setPaused] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const [answer, setAnswer] = useState<keyof typeof responses>("salud");
  const resource = resources.find((r) => r.id === selected)!;
  const related = new Set(edges.filter((e) => e.includes(selected)).flat());
  related.add(selected);
  return (
    <section
      className={`im-console ${paused ? "im-paused" : ""} ${expanded ? "im-expanded" : ""}`}
      aria-label="Mapa interactivo de infraestructura de demostración"
    >
      <header className="im-header">
        <div>
          <span className="im-eyebrow">
            <i /> ConectadOS / INFRASTRUCTURE EXPLORER
          </span>
          <h2>Todo está conectado.</h2>
          <p>Explora las relaciones de tu ecosistema.</p>
        </div>
        <span className="im-demo">TOPOLOGÍA DE EJEMPLO</span>{expanded&&<a className="im-return" href="/">← Volver a mi espacio</a>}
      </header>
      <div className="im-layout">
        <div className="im-map-column">
          <div className="im-toolbar" aria-label="Controles del mapa">
            <span>
              <Globe size={13} /> ECOSISTEMA
            </span>
            <button
              onClick={() => setPaused(!paused)}
              aria-label={paused ? "Reanudar animación" : "Pausar animación"}
            >
              {paused ? <Play size={16} /> : <Pause size={16} />}
            </button>
            <button
              onClick={() => setZoom(Math.max(0.8, +(zoom - 0.2).toFixed(1)))}
              disabled={zoom <= 0.8}
              aria-label="Alejar mapa"
            >
              <ZoomOut size={16} />
            </button>
            <output aria-label="Zoom">{Math.round(zoom * 100)}%</output>
            <button
              onClick={() => setZoom(Math.min(1.6, +(zoom + 0.2).toFixed(1)))}
              disabled={zoom >= 1.6}
              aria-label="Acercar mapa"
            >
              <ZoomIn size={16} />
            </button>
            <button
              onClick={() => {
                setZoom(1);
                setSelected("vps");
              }}
              aria-label="Restablecer mapa"
            >
              <RotateCcw size={16} />
            </button>
            <button
              onClick={() => setExpanded(!expanded)}
              aria-label={expanded ? "Reducir mapa" : "Ampliar mapa"}
              aria-pressed={expanded}
            >
              {expanded ? <><Minimize2 size={16}/><span>Reducir mapa</span></> : <Maximize2 size={16} />}
            </button>
          </div>
          <div
            className="im-scroll"
            tabIndex={0}
            role="region"
            aria-label="Mapa desplazable. Selecciona un nodo para explorar sus conexiones."
          >
            <div
              className="im-canvas"
              style={{ width: `${zoom * 100}%`, height: `${zoom * 520}px` }}
            >
              <div className="im-orbits" aria-hidden>
                <i />
                <i />
                <i />
              </div>
              <svg
                className="im-wires"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden
              >
                {edges.map(([a, b], i) => {
                  const from = nodes.find((n) => n.id === a)!;
                  const to = nodes.find((n) => n.id === b)!;
                  const active = a === selected || b === selected;
                  const path = `M ${from.x} ${from.y} C ${from.x} ${(from.y + to.y) / 2}, ${to.x} ${(from.y + to.y) / 2}, ${to.x} ${to.y}`;
                  return (
                    <g key={`${a}-${b}`} className={active ? "im-connected" : ""}>
                      <path d={path} className="im-wire" />
                      <path
                        d={path}
                        className="im-flow"
                        style={{ animationDelay: `${-i * 0.7}s` }}
                      />
                    </g>
                  );
                })}
              </svg>
              {nodes.map((n) => {
                const item = resources.find((r) => r.id === n.id)!;
                const Icon = n.icon;
                return (
                  <button
                    key={n.id}
                    className={`im-node ${n.id === "vps" ? "im-core" : ""} ${selected === n.id ? "im-selected" : ""} ${related.has(n.id) ? "im-related" : ""}`}
                    style={{ left: `${n.x}%`, top: `${n.y}%` } as CSSProperties}
                    onClick={() => setSelected(n.id)}
                    aria-pressed={selected === n.id}
                    aria-label={`${n.title}, ${n.sub}, ${item.health}. Datos de ejemplo`}
                  >
                    <span className="im-node-icon">
                      <Icon size={n.id === "vps" ? 30 : 22} />
                      <i className={item.health === "Operativo" ? "" : "im-amber"} />
                    </span>
                    <strong>{n.title}</strong>
                    <small>{n.sub}</small>
                  </button>
                );
              })}
            </div>
          </div>
          <footer className="im-map-footer">
            <span>
              <i /> Relación seleccionada
            </span>
            <span>Movimiento ilustrativo · no representa tráfico real</span>
          </footer>
        </div>
        <aside
          className="im-inspector"
          aria-label="Detalle del nodo seleccionado"
          aria-live="polite"
        >
          <span className="im-eyebrow">
            NODO / {String(nodes.findIndex((n) => n.id === selected) + 1).padStart(2, "0")}
          </span>
          <div className="im-inspector-icon">
            {selected === "vps" ? (
              <Server size={32} />
            ) : selected === "dns" ? (
              <Cloud size={32} />
            ) : (
              <Database size={32} />
            )}
          </div>
          <h3>{resource.name}</h3>
          <p>
            {resource.provider} · {resource.kind}
          </p>
          <span className={`im-health ${resource.health !== "Operativo" ? "im-amber" : ""}`}>
            {resource.health} · simulado
          </span>
          <dl>
            <div>
              <dt>Respuesta de ejemplo</dt>
              <dd>{resource.latency}</dd>
            </div>
            <div>
              <dt>Ubicación</dt>
              <dd>{resource.region}</dd>
            </div>
            <div>
              <dt>Aplicaciones asociadas</dt>
              <dd>{resource.apps.join(" · ")}</dd>
            </div>
          </dl>
          <button className="im-detail" onClick={() => onDetail(resource)}>
            Explorar recurso <ArrowUpRight size={16} />
          </button>
          <div className="im-domain-note">
            <Globe size={16} />
            <p>
              Conecta Cloudflare en el panel privado para consultar las zonas y registros DNS autorizados. Comprueba HTTPS por separado.
            </p>
          </div>
        </aside>
      </div>
      <div className="im-agent">
        <div className="im-agent-title">
          <span className="im-agent-orb">
            <Bot size={23} />
          </span>
          <div>
            <h3>Comando AI</h3>
            <span>ASISTENTE DE INFRAESTRUCTURA · CONCEPTO</span>
          </div>
          <Mail size={16} className="im-agent-signal" />
        </div>
        <div className="im-prompts" aria-label="Preguntas de demostración">
          <button aria-pressed={answer === "salud"} onClick={() => setAnswer("salud")}>
            ¿Qué necesita mi atención?
          </button>
          <button aria-pressed={answer === "dominios"} onClick={() => setAnswer("dominios")}>
            ¿Dónde están mis dominios?
          </button>
          <button aria-pressed={answer === "voz"} onClick={() => setAnswer("voz")}>
            <Mic size={15} /> Quiero hablar con el asistente
          </button>
        </div>
        <p className="im-answer" role="status">
          {responses[answer]}
        </p>
        <span className="im-disclosure">
          Respuestas de muestra · sin IA ni micrófono conectados
        </span>
      </div>
    </section>
  );
}
