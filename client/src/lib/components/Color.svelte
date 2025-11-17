<script>
  export let color;
  export let selectedColor;
  export let selectColor;

  function select() {
    selectColor(color);
  }

  function isSelected() {
    if (!selectedColor) return false;

    return selectedColor.id === color.id;
  }
</script>

<div
  class="color-item"
  style="border-left-color: {color.color};"
  class:selected={isSelected()}
>
  <div class="color-name">
    <button on:click={select}>{color.name}</button>
  </div>
</div>

<style>
  .color-item {
    margin: 4px 0;
    padding: 0 8px;
    border-left: 4px solid #666666;
  }

  .selected {
    border-left-width: 16px;
  }

  button {
    background: none;
    border: none;
    color: white;
    cursor: pointer;
    font-size: 14px;
  }
</style>
