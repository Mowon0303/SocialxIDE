import { Component, EventEmitter, Output } from '@angular/core';

@Component({
  selector: 'codeyo-review-panel',
  standalone: true,
  templateUrl: './review-panel.component.html',
})
export class ReviewPanelComponent {
  @Output() readonly openSettings = new EventEmitter<void>();
}
