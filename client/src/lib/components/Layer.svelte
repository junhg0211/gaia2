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

  function newColor() {
    const colorName = prompt("Enter color name:");
    if (!colorName) return;
    const colorValue = prompt("Enter color value (hex):", "#ffffff");
    if (!colorValue) return;
    socket.send(`newcolor\t${layer.id}\t${colorName}\t${colorValue}`);
  }

  function newLayer() {
    const layerName = prompt("Enter layer name:");
    if (!layerName) return;
    socket.send(`newlayer\t${layer.id}\t${layerName}`);
  }
</script>

<div class="layer-item">
  <div class="layer-name">
    {layer.name}
  </div>
  <div class="layer-colors">
    {#each layer.colors as color}
      <ColorComponent {socket} {color} {selectedColor} {selectColor} />
    {/each}
    <div class="color-button">
      <button on:click={newColor}>
        <i class="bi bi-plus-lg"></i> Add Color
      </button>
    </div>
  </div>
  <div class="layer-children">
    {#each layer.children as child}
      <Layer layer={child} {socket} {selectedColor} {selectColor} {rerender} />
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
    padding: 0 8px;
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
