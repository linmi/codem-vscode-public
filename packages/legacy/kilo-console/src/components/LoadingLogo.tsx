const src = `${import.meta.env.BASE_URL}codem-logo.svg`

export function LoadingLogo(props: { class?: string }) {
  return <img src={src} class={`console-loading-logo${props.class ? ` ${props.class}` : ""}`} alt="CodeM loading" />
}
