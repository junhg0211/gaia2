<script lang="ts">
  import ColorComponent from './Color.svelte';
  import Layer from './Layer.svelte';
  import { Color as ColorClass, Layer as LayerClass } from '../../../../dataframe.js';
  import "bootstrap-icons/font/bootstrap-icons.css";

  export let layer: LayerClass;
  export let socket: WebSocket;
  export let selectedColor: ColorClass | null;
  export let selectColor: (c: ColorClass) => void;
  export let rerender: () => void;
  export let render: () => void;

  function newColor() {
    const colorName = prompt("색상의 이름을 입력하세요:");
    if (!colorName) return;
    const colorValue = prompt("색상의 값(헥스)을 입력하세요:", "#ffffff");
    if (!colorValue) return;
    socket.send(`newcolor\t${layer.id}\t${colorName}\t${colorValue}`);
  }

  function newLayer() {
    const layerName = prompt("Enter layer name:");
    if (!layerName) return;
    socket.send(`newlayer\t${layer.id}\t${layerName}`);
  }

  function setOpacity(e: Event) {
    const newOpacity = parseInt((e.target as HTMLInputElement).value) / 100;
    layer.opacity = newOpacity;
    render();
  }


  function renameLayer(event: MouseEvent) {
    const newName = prompt("새로운 레이어 이름을 입력하세요:", layer.name);
    if (!newName) return;
    socket.send(`renamelayer\t${layer.id}\t${newName}`);
  }
</script>

<div class="layer-item">
  <button class="layer-name" on:dblclick={renameLayer}>{layer.name}</button>
  <div class="layer-opacity">
    <input type="range" min="0" max="100" value={layer.opacity * 100} on:input={setOpacity} />
  </div>
  <div class="layer-colors">
    {#each layer.colors as color}
      <ColorComponent {socket} {color} {selectedColor} {selectColor} removeable={color !== layer.colors[0]} />
    {/each}
    <div class="color-button">
      <button on:click={newColor}>
        <i class="bi bi-plus-lg"></i> Add Color
      </button>
    </div>
  </div>
  <div class="layer-children">
    {#each layer.children as child}
      <Layer layer={child} {socket} {selectedColor} {selectColor} {rerender} {render} />
    {/each}
    <div class="color-button">
      <button on:click={newLayer}>
        <i class="bi bi-plus-lg"></i> Add Layer
      </button>
    </div>
  </div>
</div>

<style>
  .layer-item {
    margin-top: 8px;
    padding-left: 8px;
    border-left: 4px solid #444444;
  }

  button {
    background: none;
    border: none;
    color: white;
    cursor: pointer;
    padding: 4px 0;
    font-size: 14px;
  }
</style>
