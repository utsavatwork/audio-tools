import "./style.css";
import heroImg from "./assets/hero.png";
import typescriptLogo from "./assets/typescript.svg";
import viteLogo from "./assets/vite.svg";
import { setupCounter } from "./counter.ts";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
<section id="center">
  <div class="hero">
    <img src="${heroImg}" class="base" width="170" height="179">
    <img src="${typescriptLogo}" class="framework" alt="TypeScript logo"/>
    <img src="${viteLogo}" class="vite" alt="Vite logo" />
  </div>
  <div>

    <h2>Audio File Trimmer and Vocals Remover</h2>
    <h1>Coming Soon...</h1>

  </div>
</section>
`;

setupCounter(document.querySelector<HTMLButtonElement>("#counter")!);
