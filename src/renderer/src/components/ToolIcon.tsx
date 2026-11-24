// Iconos con vida para las herramientas de audio (inspirados en los mosaicos de Inicio de Cauce):
//   • Audio: los audífonos se mecen al ritmo y suben notas musicales;
//   • Lector: una línea de lectura barre el libro y el libro «respira» al pasar página;
//   • Reuniones: globos de diálogo aparecen por turnos, como una conversación;
//   • Traducción: el globo se balancea y una letra se convierte en otra (A → 文).
// Cada uno con su ritmo y pausas largas para que no se muevan a la vez; en la sección abierta o al
// pasar el puntero van más rápido. Con «reducir movimiento» se quedan quietos (styles.css).
import { NavIcon } from './NavIcon'

export type Tool = 'audio' | 'lector' | 'reuniones' | 'traduccion'

export function ToolIcon({ tool }: { tool: Tool }): JSX.Element {
  return (
    <span className={`tool-icon tool-${tool}`} aria-hidden="true">
      <span className="tool-glyph"><NavIcon id={tool} /></span>
      {tool === 'audio' && <><span className="tool-fx note n1">♪</span><span className="tool-fx note n2">♫</span></>}
      {tool === 'lector' && <span className="tool-fx scan" />}
      {tool === 'reuniones' && <><span className="tool-fx bubble b1" /><span className="tool-fx bubble b2" /></>}
      {tool === 'traduccion' && <><span className="tool-fx glyph-a">A</span><span className="tool-fx glyph-b">文</span></>}
    </span>
  )
}
