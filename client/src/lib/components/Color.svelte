<script lang="ts">
  import type { Color as ColorClass } from '../../../../dataframe.js';
  import "bootstrap-icons/font/bootstrap-icons.css";

  export let socket: WebSocket;
  export let color: ColorClass;
  export let selectedColor: ColorClass | null;
  export let selectColor: (c: ColorClass) => void;
  export let removeable: boolean = true;

  function select() {
    selectColor(color);
  }

  function renameColor() {
    const newName = prompt("새로운 색상 이름을 입력하세요:", color.name);
    if (!newName) return;
    const newColor = prompt("새로운 색상 값(헥스)을 입력하세요:", color.color);
    if (!newColor) return;

    socket.send(`renamecolor\t${color.id}\t${newName}`);
    socket.send(`changecolor\t${color.id}\t${newColor}`);
  }

  function removeColor() {
    if (!confirm(`정말로 색상 "${color.name}"을 삭제하시겠습니까?`)) return;
    socket.send(`removecolor\t${color.id}`);
  }

  function toggleLock() {
    socket.send(`setcolorlock\t${color.id}\t${color.locked ? 0 : 1}`);
  }

  function isSelected(): boolean {
    if (!selectedColor) return false;

    return selectedColor.id === color.id;
  }
</script>

<div
  class="color-item"
  class:selected={isSelected()}
>
  <div class="color-name">
    <button on:click={select} on:dblclick={renameColor} class="color-button">
      <span style="color: {color.color};">&#x25CF;</span> {color.name} #{color.id}
    </button>
    <button on:click={toggleLock} class="button" class:locked={color.locked} aria-label="lock">
      <i class="bi bi-lock"></i>
    </button>
    {#if removeable}
      <button on:click={removeColor} class="button" aria-label="rename">
        <i class="bi bi-trash"></i>
      </button>
    {/if}
  </div>
</div>

<style>
  .color-item {
    margin: 4px 0;
    padding-left: 8px;
    border-left: 4px solid #666666;
    transition: all 0.2s;
  }

  .selected {
    border-left-width: 16px;
  }

  button {
    background: none;
    border: none;
    color: white;
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.2s;
  }

  button:hover {
    background-color: #444444;
  }

  .color-button {
    font-size: 14px;
  }

  .button {
    float: right;
  }

  .locked {
    color: #ffcc00;
  }
</style>
