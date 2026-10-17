/// <reference types="vite/client" />
import type { JSX as ReactJSX } from 'react'
import type { Api } from '../../preload'

declare global {
  interface Window { api: Api }
  namespace JSX {
    type Element = ReactJSX.Element
    type IntrinsicElements = ReactJSX.IntrinsicElements
  }
}
